/**
 * 闭关修炼 / 凝灵吐纳。
 *
 * 设计约定（按阶段一评审意见修订）：
 *  - 闭关：只产修为，不产灵石。修为满时不可闭关，避免「无意义空转」。
 *  - 凝灵：只产灵石，不产修为。是突破材料唯一来源（阶段二会由历练接替）。
 *  - 两个行动都要消耗游戏时间，所以「时间」是真实成本。
 */
import { getRealm } from '../data/realms.js';
import { getRoot, getTalent } from '../data/backgrounds.js';
import { addLog, clamp, isAtPeak, isDead, maxHp, sanitize } from './gameState.js';

export const CULTIVATE_MONTHS = 3;

/** 闭关可能触发的微小征兆：只影响少量数值，正式奇遇在阶段二 */
const OMENS = [
  { text: '洞府外的老松忽然无风自动，你只当是山风过境。', effect: null },
  { text: '吐纳间有一缕清气自行入体，修为小有增益。', effect: { exp: 0.15 } },
  { text: '你在蒲团下摸到一枚旧年灵石，虽已黯淡，仍可换些散碎。', effect: { stones: 3 } },
  { text: '心浮气躁，一缕灵气走岔，胸口气闷。', effect: { hp: -0.1 } },
];

function fail(reason, extra = {}) {
  return { ok: false, reason, gained: 0, stones: 0, months: 0, capped: false, omen: null, died: false, ...extra };
}

/**
 * 闭关修炼：消耗 3 个月，只涨修为。
 * @returns {{ok:boolean, reason?:string, gained:number, months:number, capped:boolean, omen:string|null, died:boolean}}
 */
export function cultivate(character, rng) {
  if (isDead(character)) return fail('寿元已尽', { died: true });
  if (isAtPeak(character)) return fail('已达金丹初期，修为再无可进', { capped: true });

  const realmCheck = getRealm(character.realmId);
  if (realmCheck.expToNext !== null && character.exp >= realmCheck.expToNext) {
    return fail('修为已满，请先突破境界，或改为凝灵吐纳', { capped: true });
  }

  const realm = getRealm(character.realmId);
  const root = getRoot(character.rootId);
  const talent = getTalent(character.talentId);
  const rootMult = root ? root.mult : 1;
  const cultMult = talent ? talent.cultMult : 1;

  const base = realm.perMonth * rootMult * cultMult * CULTIVATE_MONTHS;
  const gained = Math.max(1, Math.round(base * rng.range(0.85, 1.15)));

  const before = character.exp;
  character.exp = Math.min(realm.expToNext, character.exp + gained);
  const actualGain = character.exp - before;
  const capped = character.exp >= realm.expToNext;

  character.months += CULTIVATE_MONTHS;

  let omenText = null;
  if (rng.chance(0.12)) {
    const omen = rng.pick(OMENS);
    omenText = omen.text;
    if (omen.effect) applyOmen(character, omen.effect, rng);
  }

  addLog(
    character,
    `闭关三月，修为 +${actualGain}${capped ? '（修为已满，需突破或凝灵）' : ''}。`,
    capped ? 'milestone' : 'cultivate'
  );
  if (omenText) addLog(character, omenText, 'omen');

  character.hp = clamp(character.hp, 0, maxHp(character));
  sanitize(character);

  return { ok: true, gained: actualGain, stones: 0, months: CULTIVATE_MONTHS, capped, omen: omenText, died: isDead(character) };
}

/**
 * 凝灵吐纳：消耗 3 个月，只产灵石（突破材料来源）。
 *
 * 收益是**固定值**，不随灵根缩放 —— 否则「灵根好」会同时带来「修炼快 + 赚钱快」，
 * 让差灵根承受双重劣势。灵根只影响修炼，资源获取交给独立属性（阶段二接历练）。
 * @returns {{ok:boolean, reason?:string, gained:number, stones:number, months:number, died:boolean}}
 */
export const CONDENSE_BASE = 5;

export function condenseSpirit(character, rng) {
  if (isDead(character)) return { ok: false, reason: '寿元已尽', gained: 0, stones: 0, months: 0, died: true };

  const stones = Math.max(1, Math.round(CONDENSE_BASE * rng.range(0.9, 1.3)));

  character.stones += stones;
  character.months += CULTIVATE_MONTHS;
  addLog(character, `你在灵脉旁凝灵三月，得灵石 +${stones}。`, 'cultivate');

  character.hp = clamp(character.hp, 0, maxHp(character));
  sanitize(character);

  return { ok: true, gained: 0, stones, months: CULTIVATE_MONTHS, died: isDead(character) };
}

function applyOmen(character, effect, rng) {
  if (typeof effect.exp === 'number') {
    const realm = getRealm(character.realmId);
    if (realm.expToNext !== null) {
      const bonus = Math.round(realm.expToNext * effect.exp * rng.range(0.8, 1.2));
      character.exp = Math.min(realm.expToNext, character.exp + bonus);
    }
  }
  if (typeof effect.stones === 'number') {
    character.stones = Math.max(0, character.stones + effect.stones);
  }
  if (typeof effect.hp === 'number') {
    const delta = Math.round(maxHp(character) * effect.hp);
    character.hp = Math.max(1, character.hp + delta);
  }
}

/**
 * 洞府休养：消耗 3 个月恢复气血。
 * 这是战斗受伤后最便宜的恢复途径（对应评审「战败后必须有明确恢复路径」）。
 */
export const REST_MONTHS = 3;
export const REST_HEAL_RATIO = 0.35;

export function restHeal(character, rng) {
  if (isDead(character)) return { ok: false, reason: '寿元已尽', healed: 0, months: 0, died: true };
  const max = maxHp(character);
  if (character.hp >= max) {
    return { ok: false, reason: '气血已满，无需休养', healed: 0, months: 0, died: false };
  }
  const heal = Math.max(1, Math.round(max * REST_HEAL_RATIO * rng.range(0.9, 1.1)));
  const before = character.hp;
  character.hp = clamp(character.hp + heal, 1, max);
  character.months += REST_MONTHS;
  addLog(character, `你在洞府静养三月，气血 +${character.hp - before}。`, 'cultivate');
  sanitize(character);
  return { ok: true, healed: character.hp - before, months: REST_MONTHS, died: isDead(character) };
}

