/**
 * 突破境界（含软保底）。
 *
 * 规则
 *  - 修为必须满、灵石必须够；失败不掉境界、绝不致死。
 *  - 软保底：同一境界连续失败 N 次，成功率 +N×5 个百分点；第 5 次必定成功。
 *    保底计数写入存档，成功后清零。这样连续霉运不会让玩家陷入长时间卡关。
 */
import { getRealm, isFinalRealm } from '../data/realms.js';
import { getTalent } from '../data/backgrounds.js';
import { addLog, clamp, isAtPeak, isDead, maxHp, sanitize } from './gameState.js';

export const PITY_STEP = 0.05;
export const PITY_GUARANTEE = 5;
/** 保底计数合法范围 0..PITY_GUARANTEE，超过即视为异常存档 */
export const MAX_PITY = PITY_GUARANTEE;

function pityCount(character) {
  if (!character.pity || typeof character.pity !== 'object') character.pity = {};
  const value = character.pity[character.realmId];
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** 保底带来的加成（百分点转小数），达到上限则直接 100% */
export function pityBonus(character) {
  const count = pityCount(character);
  if (count >= PITY_GUARANTEE) return 1;
  return count * PITY_STEP;
}

/** 实际成功率：基础 + 天赋 + 软保底，夹在 5% ~ 100% */
export function breakthroughChance(character) {
  const realm = getRealm(character.realmId);
  if (realm.rate === null) return 0;
  if (pityCount(character) >= PITY_GUARANTEE) return 1;

  const talent = getTalent(character.talentId);
  const talentBonus = talent ? talent.breakthroughBonus : 0;
  return clamp(realm.rate + talentBonus + pityBonus(character), 0.05, 1);
}

/** 返回能否突破以及原因，UI 直接拿来显示 */
export function canBreakthrough(character) {
  const realm = getRealm(character.realmId);
  const reasons = [];
  if (isDead(character)) reasons.push('寿元已尽');
  if (isFinalRealm(character.realmId) || realm.expToNext === null) reasons.push('已是终点境界');
  if (!isAtPeak(character)) {
    const need = Math.max(0, (realm.expToNext || 0) - character.exp);
    if (need > 0) reasons.push(`修为未满，还差 ${need} 点`);
  }
  if (character.stones < realm.costStones) {
    reasons.push(`灵石不足，需要 ${realm.costStones}，现有 ${character.stones}（可去凝灵）`);
  }
  return { ok: reasons.length === 0, reasons, chance: breakthroughChance(character), cost: realm.costStones };
}

export function attemptBreakthrough(character, rng) {
  const check = canBreakthrough(character);
  if (!check.ok) {
    return { ok: false, reason: check.reasons.join('；'), success: false, chance: check.chance, nextRealm: null, lostExp: 0, lostHp: 0, monthsLost: 0 };
  }

  const realm = getRealm(character.realmId);
  const chance = check.chance;
  const success = chance >= 1 || rng.chance(chance);

  if (success) {
    character.stones -= realm.costStones;
    character.realmId += 1;
    character.exp = 0;
    character.hp = maxHp(character);
    if (character.pity) delete character.pity[character.realmId - 1];
    const nextName = getRealm(character.realmId).name;
    addLog(character, `天地灵气倒灌，你一举突破至「${nextName}」！`, 'milestone');
    sanitize(character);
    return { ok: true, success: true, chance, nextRealm: nextName, lostExp: 0, lostHp: 0, monthsLost: 0 };
  }

  // 失败惩罚：损失两成半修为、两成气血、六个月时光；气血保底 1，不会死。
  const cap = realm.expToNext || 0;
  const lostExp = Math.floor(cap * 0.25);
  character.exp = Math.max(0, character.exp - lostExp);
  const hpBefore = character.hp;
  character.hp = Math.max(1, Math.round(character.hp * 0.8));
  const lostHp = hpBefore - character.hp;
  character.months += 6;

  const realmId = character.realmId;
  const pity = Math.min(PITY_GUARANTEE, pityCount(character) + 1);
  if (!character.pity) character.pity = {};
  character.pity[realmId] = pity;

  addLog(
    character,
    `冲击「${getRealm(realmId + 1).name}」失败，气血翻涌。修为 -${lostExp}，气血 -${lostHp}，耗去半年。下次成功率 +${pity * 5}%（第 ${pity} 次失败）`,
    'danger'
  );
  sanitize(character);
  return { ok: true, success: false, chance, nextRealm: null, lostExp, lostHp, monthsLost: 6, pity };
}


/**
 * 突破预测：给界面显示用，不参与判定。
 * @returns {{
 *   chance: number, shownPct: number, pityCount: number,
 *   nextChancePct: number, attemptsToGuarantee: number,
 *   lossExpRatio: number, lossHpRatio: number, monthsLost: number
 * }}
 */
export function breakthroughForecast(character) {
  const realm = getRealm(character.realmId);
  const chance = breakthroughChance(character);
  const count = pityCount(character);
  const nextChance = clamp(chance + (count >= PITY_GUARANTEE ? 0 : PITY_STEP), 0, 1);
  return {
    chance,
    shownPct: Math.round(chance * 100),
    pityCount: count,
    nextChancePct: Math.round(nextChance * 100),
    attemptsToGuarantee: Math.max(0, PITY_GUARANTEE - count),
    lossExpRatio: 0.25,
    lossHpRatio: 0.2,
    monthsLost: 6,
    costStones: realm.costStones || 0,
  };
}
