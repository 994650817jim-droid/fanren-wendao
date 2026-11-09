/**
 * 最小回合制战斗（阶段二）—— 权威状态版
 *
 * 对应源码复核 P0-3 / P0-4：
 *  - 战斗状态只存在于 character.combat（权威状态），随存档持久化；
 *  - 前端只能传「动作」，不能回传战斗对象，因此无法用旧快照重复结算；
 *  - resolveTurn 只读 draft.combat，结算完成即清空，同一场战斗不能二次发奖；
 *  - 刷新页面时若 character.combat 仍在 active 状态，UI 会恢复战斗。
 */
import { getRealm } from '../data/realms.js';
import { getEnemy } from '../data/enemies.js';
import { getBoss } from '../data/boss.js';
import { PILL_HEAL_RATIO, PILL_MAX_PER_BATTLE, PILL_NAME, canUsePill, consumePill } from './inventory.js';
import { addLog, clamp, isDead, maxHp, sanitize } from './gameState.js';

export const COMBAT_ACTIONS = { ATTACK: 'attack', SKILL: 'skill', ITEM: 'item', FLEE: 'flee', DEFEND: 'defend' };
/** @typedef {'victory' | 'defeat' | 'flee'} CombatResult */
export const MAX_ROUNDS = 30;
export const SKILL_COOLDOWN = 3;
export const PILL_COST_STONES = 8;
export const FLEE_BASE_CHANCE = 0.5;

function realmScale(character) {
  return 1 + character.realmId * 0.12;
}

export function hasActiveCombat(character) {
  return Boolean(character && character.combat && character.combat.status === 'active');
}

/** 开战：把战斗写入角色权威状态 */
function enemyTier(enemyId) {
  const enemy = getEnemy(enemyId);
  return enemy && enemy.tier === 'elite' ? 'elite' : 'normal';
}

export function startCombat(character, enemyId, rng) {
  const boss = getBoss(enemyId);
  if (boss) {
    if (hasActiveCombat(character)) return { ok: false, reason: '已有战斗在进行' };
    if (isDead(character)) return { ok: false, reason: '寿元已尽，无法应战' };
    if (character.realmId < boss.minRealm) return { ok: false, reason: '境界不足，祭坛尚未对你开启' };
    if (character.victory) return { ok: false, reason: '你已通过最终试炼' };
    character.combat = {
      id: 'boss-' + character.months + '-' + rng.int(100000, 999999),
      enemyId: boss.id,
      enemySprite: boss.sprite,
      enemyName: boss.name,
      enemyDesc: boss.desc,
      enemyHp: boss.hp,
      enemyMaxHp: boss.hp,
      enemyAtk: boss.atk,
      enemyDef: boss.def,
      rewardStones: boss.rewardStones,
      rewardExpRatio: 0,
      round: 1,
      cooldown: 0,
      status: 'active',
      pillsUsed: 0,
      isBoss: true,
      phase: 1,
      telegraph: false,
      residualThunder: 0,
      counterBonus: false,
      thunderStats: { warned: 0, defended: 0, missed: 0, recovered: 0 },
      log: ['祭坛之上，雷云翻涌。' + boss.name + '缓缓抬头。'],
    };
    return { ok: true, combat: { ...character.combat } };
  }
  const base = getEnemy(enemyId);
  if (!base) return { ok: false, reason: '妖兽不存在' };
  if (hasActiveCombat(character)) return { ok: false, reason: '已有战斗在进行' };
  if (isDead(character)) return { ok: false, reason: '寿元已尽，无法应战' };
  if (character.realmId < base.minRealm) return { ok: false, reason: '境界不足，遇到此兽只会送命' };
  if (character.hp <= 0) return { ok: false, reason: '气血耗尽，无法应战' };

  const scale = realmScale(character);
  const hp = Math.round(base.hp * scale * rng.range(0.9, 1.1));
  character.combat = {
    id: 'combat-' + character.months + '-' + base.id + '-' + rng.int(100000, 999999),
    enemyId: base.id,
    enemySprite: base.sprite || null,
    enemyName: base.name,
    enemyDesc: base.desc,
    enemyHp: hp,
    enemyMaxHp: hp,
    enemyAtk: Math.round(base.atk * scale * rng.range(0.9, 1.1)),
    enemyDef: Math.round(base.def * scale),
    rewardStones: Math.round(base.rewardStones * scale),
    rewardExpRatio: base.rewardExpRatio,
    round: 1,
    cooldown: 0,
    status: 'active',
    pillsUsed: 0,
    log: [`你在山道上撞见了「${base.name}」。`],
  };
  return { ok: true, combat: { ...character.combat } };
}

/**
 * 结算一个回合。只读 character.combat，接受的动作只有四种。
 * @returns {{ok:boolean, reason?:string, combat:object|null, events:string[],
 *            finished:boolean, result?:'victory'|'defeat'|'flee'}}
 */
export function resolveTurn(character, action, rng) {
  const combat = character.combat;
  const baseTier = combat ? enemyTier(combat.enemyId) : 'normal';
  if (!combat || combat.status !== 'active') {
    return { ok: false, reason: '当前没有进行中的战斗', combat: null, events: [], finished: true };
  }
  const events = [];
  const push = (text) => {
    events.push(text);
    combat.log.push(text);
  };

  let acted = false;

  // 所有非终局回合（含预警/余雷）都走同一个超时判断
  const settleTimeout = () => {
    combat.status = 'settled';
    character.combat = null;
    addLog(character, '与「' + combat.enemyName + '」缠斗太久，你选择脱身。', 'danger');
    sanitize(character);
    return { ok: true, combat: { ...combat }, events: [...events, '缠斗太久，你抽身退走。'], finished: true, result: /** @type {CombatResult} */ ('flee') };
  };

  const isBoss = Boolean(combat.isBoss);
  let defended = false;

  if (action === COMBAT_ACTIONS.DEFEND) {
    defended = true;
    acted = true;
    push('你收剑护体，凝神以待。');
  } else if (action === COMBAT_ACTIONS.FLEE) {
    const chance = FLEE_BASE_CHANCE + character.realmId * 0.01;
    if (rng.chance(chance)) {
      combat.status = 'settled';
      character.combat = null;
      addLog(character, `遭遇「${combat.enemyName}」，你选择了退走。`, 'danger');
      sanitize(character);
      return { ok: true, combat: { ...combat }, events: ['你借着山雾抽身退走，妖兽没有追来。'], finished: true, result: /** @type {CombatResult} */ ('flee') };
    }
    const penalty = Math.round(maxHp(character) * 0.08);
    character.hp = Math.max(1, character.hp - penalty);
    push(`你转身欲走，却被「${combat.enemyName}」咬中后背，气血 -${penalty}。`);
    acted = true;
  } else if (action === COMBAT_ACTIONS.ITEM) {
    const usable = canUsePill(character, combat.pillsUsed || 0);
    if (!usable.ok) return { ok: false, reason: usable.reason, combat, events: [], finished: false };
    consumePill(character);
    combat.pillsUsed = (combat.pillsUsed || 0) + 1;
    const heal = Math.round(maxHp(character) * PILL_HEAL_RATIO);
    const before = character.hp;
    character.hp = clamp(character.hp + heal, 1, maxHp(character));
    push(`你服下一枚${PILL_NAME}，气血 +${character.hp - before}（此战已服 ${combat.pillsUsed}/${PILL_MAX_PER_BATTLE}）。`);
    acted = true;
  } else if (action === COMBAT_ACTIONS.ATTACK || action === COMBAT_ACTIONS.SKILL) {
    const isSkill = action === COMBAT_ACTIONS.SKILL;
    if (isSkill && combat.cooldown > 0) {
      return { ok: false, reason: `技能尚需 ${combat.cooldown} 回合冷却`, combat, events: [], finished: false };
    }
    const playerAtk = 10 + character.realmId * 4;
    const power = isSkill ? 1.9 : 1;
    // 分层目标胜率：普通妖兽 75-85%，精英妖兽 50-65%
    const tierMod = combat.isBoss ? 1.0 : baseTier === 'elite' ? 0.97 : 1.1;
    const counterMult = combat.counterBonus ? 1.25 : 1;
    const damage = Math.max(1, Math.round((playerAtk * power * tierMod - combat.enemyDef * 0.6) * counterMult * rng.range(0.85, 1.15)));
    if (combat.counterBonus) combat.counterBonus = false;
    combat.enemyHp = Math.max(0, combat.enemyHp - damage);
    if (isSkill) combat.cooldown = SKILL_COOLDOWN;
    push(isSkill ? `你掐诀引动灵力，重创「${combat.enemyName}」，伤害 ${damage}。` : `你挥剑劈出，造成 ${damage} 伤害。`);
    acted = true;
  } else {
    return { ok: false, reason: `未知战斗行动：${action}`, combat, events: [], finished: false };
  }

  if (combat.cooldown > 0) combat.cooldown -= 1;

  // 二阶段：血量低于阈值进入，只触发一次
  if (isBoss && combat.phase === 1 && combat.enemyHp > 0 && combat.enemyHp < combat.enemyMaxHp * 0.5) {
    const boss = getBoss(combat.enemyId);
    combat.phase = 2;
    combat.enemyAtk = Math.round(combat.enemyAtk * (boss ? boss.phase2AtkScale : 1.3));
    push('古灵身上的雷纹骤然亮起——它进入了第二阶段。');
    addLog(character, '雷霆麒麟·镇坛古灵进入第二阶段。', 'danger');
  }

  if (combat.enemyHp <= 0) {
    const stones = combat.rewardStones;
    character.stones += stones;
    const realm = getRealm(character.realmId);
    let expGain = 0;
    if (realm.expToNext !== null) {
      const before = character.exp;
      character.exp = clamp(character.exp + Math.round(realm.expToNext * combat.rewardExpRatio), 0, realm.expToNext);
      expGain = character.exp - before;
    }
    combat.status = 'settled';
    character.combat = null;
    if (combat.isBoss && !character.victory) {
      character.victory = true;
      push('雷云散尽，祭坛归于寂静。你已通过最终试炼。');
      addLog(character, '你在金丹祭坛上击败了雷霆麒麟·镇坛古灵，青云山云开雾散。', 'milestone');
    }
    addLog(character, `你击败了「${combat.enemyName}」，得灵石 +${stones}，修为 +${expGain}。`, 'milestone');
    sanitize(character);
    const result = { ...combat };
    return { ok: true, combat: result, events: [...events, `「${combat.enemyName}」倒下了。灵石 +${stones}，修为 +${expGain}。`], finished: true, result: /** @type {CombatResult} */ ('victory') };
  }

  if (acted) {
    const boss = isBoss ? getBoss(combat.enemyId) : null;

    // Boss 蓄力回合：本回合不造成伤害，而是给玩家一回合预警
    if (isBoss && boss && !combat.telegraph && !combat.residualThunder && combat.round % boss.telegraphEvery === 0) {
      combat.telegraph = true;
      combat.thunderStats = combat.thunderStats || { warned: 0, defended: 0, missed: 0, recovered: 0 };
      combat.thunderStats.warned += 1;
      push('雷云在古灵角间凝聚——下一回合雷霆将落，可运功防御。');
      combat.round += 1;
      if (combat.round > MAX_ROUNDS) return /** @type {any} */ (settleTimeout());
      sanitize(character);
      return { ok: true, combat: { ...combat }, events, finished: false };
    }

    // 余雷追击：上一回合漏防留下的 40% 雷霆，本回合仍可化解
    if (isBoss && boss && combat.residualThunder > 0) {
      const residual = Math.max(1, Math.round(combat.residualThunder));
      combat.residualThunder = 0;
      if (defended) {
        const absorbed = Math.round(residual * 0.8);
        const taken = Math.max(1, residual - absorbed);
        character.hp = Math.max(0, character.hp - taken);
        combat.thunderStats = combat.thunderStats || { warned: 0, defended: 0, missed: 0, recovered: 0 };
        combat.thunderStats.recovered += 1;
        push(`你运气化解余雷，仅受 ${taken} 点伤害。`);
      } else {
        character.hp = Math.max(0, character.hp - residual);
        push(`余雷未散，你气血 -${residual}。`);
      }
      if (character.hp <= 0) {
        character.hp = 1;
        const lost = Math.round(character.stones * 0.2);
        character.stones = Math.max(0, character.stones - lost);
        combat.status = 'settled';
        character.combat = null;
        addLog(character, `你被「${combat.enemyName}」的余雷击倒，损失灵石 ${lost}，勉强逃回洞府。`, 'danger');
        sanitize(character);
        return { ok: true, combat: { ...combat }, events: [...events, `你力竭倒地，拼死逃回洞府。损失灵石 ${lost}。`], finished: true, result: /** @type {CombatResult} */ ('defeat') };
      }
      combat.round += 1;
      if (combat.round > MAX_ROUNDS) return /** @type {any} */ (settleTimeout());
      sanitize(character);
      return { ok: true, combat: { ...combat }, events, finished: false };
    }

    let enemyDamage = 0;
    let label = '反击';
    if (isBoss && boss && combat.telegraph) {
      // 完整雷霆伤害只随机一次：60% 立即、40% 余雷，由同一次 D 严格拆分
      const thunderBase = (combat.enemyAtk - (5 + character.realmId * 3)) * boss.thunderScale;
      const full = Math.max(1, Math.round(thunderBase * 0.85 * rng.range(0.8, 1.2)));
      combat.telegraph = false;
      label = '雷霆';
      if (defended) {
        enemyDamage = Math.max(1, Math.round(full * (1 - boss.defendThunderReduction)));
        combat.thunderStats = combat.thunderStats || { warned: 0, defended: 0, missed: 0, recovered: 0 };
        combat.thunderStats.defended += 1;
        combat.counterBonus = true;
        push('护体剑气抵消了大半来势，你借势蓄力（下次攻击 +25%）。');
      } else {
        const immediate = Math.max(1, Math.round(full * 0.6));
        combat.residualThunder = Math.max(1, full - immediate);
        combat.thunderStats = combat.thunderStats || { warned: 0, defended: 0, missed: 0, recovered: 0 };
        combat.thunderStats.missed += 1;
        enemyDamage = immediate;
        push('雷霆落下，你未能及时运功，余雷尚未散尽（下回合可补防化解）。');
      }
    } else {
      let rawDamage = combat.enemyAtk - (5 + character.realmId * 3);
      if (defended) {
        const reduction = boss ? boss.defendReduction : 0.5;
        rawDamage *= 1 - reduction;
        push('护体剑气抵消了大半来势。');
      }
      enemyDamage = Math.max(1, Math.round(rawDamage * 0.85 * rng.range(0.8, 1.2)));
    }
    character.hp = Math.max(0, character.hp - enemyDamage);
    push(`「${combat.enemyName}」${label}，你气血 -${enemyDamage}。`);

    if (character.hp <= 0) {
      character.hp = 1;
      const lost = Math.round(character.stones * 0.2);
      character.stones = Math.max(0, character.stones - lost);
      combat.status = 'settled';
      character.combat = null;
      addLog(character, `你被「${combat.enemyName}」击败，损失灵石 ${lost}，勉强逃回洞府。`, 'danger');
      sanitize(character);
      return { ok: true, combat: { ...combat }, events: [...events, `你力竭倒地，拼死逃回洞府。损失灵石 ${lost}。`], finished: true, result: /** @type {CombatResult} */ ('defeat') };
    }

    combat.round += 1;
    if (combat.round > MAX_ROUNDS) return /** @type {any} */ (settleTimeout());
  }

  sanitize(character);
  return { ok: true, combat: { ...combat }, events, finished: false };
}




















/**
 * 是否需要给「首次战败」的雷霆教学提示。
 * 只有真的遭遇过雷霆、漏防过、且从未成功防御过，才需要教学。
 * 反向条件（成功防御过 → 不提示）由单元测试覆盖。
 */
export function shouldTeachThunderDefense(combat) {
  if (!combat || !combat.isBoss) return false;
  const stats = combat.thunderStats || { warned: 0, defended: 0, missed: 0, recovered: 0 };
  return stats.warned > 0 && stats.missed > 0 && stats.defended === 0;
}

