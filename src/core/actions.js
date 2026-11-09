/**
 * 统一行动结算（原子事务版，对应源码评审 P0-2）。
 *
 * 约定：
 *  - 所有行动都在 structuredClone 出来的 draft 上执行。
 *  - 行动失败 / 抛异常 / 结算后校验不通过 → 原角色对象**一个字段都不改**，返回失败。
 *  - 成功时返回新的角色对象，调用方必须采用 `result.character` 替换旧引用。
 *  - 存在待处理奇遇时，除「做选择」外的行动一律拒绝（对应 P0-1）。
 */
import { condenseSpirit, cultivate, restHeal } from './cultivation.js';
import { addLog } from './gameState.js';
import { PILL_NAME, PILL_PRICE, buyPills } from './inventory.js';
import { attemptBreakthrough } from './breakthrough.js';
import { applyChoice, hasPendingEvent, startExplore } from './explore.js';
import { hasActiveCombat, resolveTurn, startCombat } from './combat.js';
import { getRealm } from '../data/realms.js';
import { maxHp } from './gameState.js';

export const ACTIONS = {
  CULTIVATE: 'cultivate',
  CONDENSE: 'condense',
  BREAKTHROUGH: 'breakthrough',
  EXPLORE: 'explore',
  CHOOSE: 'choose',
  COMBAT_START: 'combat_start',
  COMBAT_TURN: 'combat_turn',
  REST: 'rest',
  DEFEND: 'defend',
  BUY_PILL: 'buy_pill',
};

/** 结算后的状态自检：任何越界都视为事务失败 */
export function validateState(character) {
  if (!character || typeof character !== 'object') return '角色状态缺失';
  for (const key of ['exp', 'hp', 'stones', 'months']) {
    if (typeof character[key] !== 'number' || !Number.isFinite(character[key])) return `字段 ${key} 非法`;
    if (character[key] < 0) return `字段 ${key} 为负`;
  }
  const realm = getRealm(character.realmId);
  if (realm.expToNext !== null && character.exp > realm.expToNext) return '修为超过上限';
  if (character.hp > maxHp(character)) return '气血超过上限';
  if (character.combat) {
    if (typeof character.combat !== 'object' || character.combat.status !== 'active') return '战斗状态非法';
    if (typeof character.combat.enemyHp !== 'number' || character.combat.enemyHp < 0) return '战斗敌人气血非法';
  }
  if (hasPendingEvent(character) && typeof character.pendingEvent.eventId !== 'string') return '待处理奇遇非法';
  return null;
}

function execute(draft, action, rng, payload) {
  switch (action) {
    case ACTIONS.CULTIVATE:
      return cultivate(draft, rng);
    case ACTIONS.CONDENSE:
      return condenseSpirit(draft, rng);
    case ACTIONS.BREAKTHROUGH:
      return attemptBreakthrough(draft, rng);
    case ACTIONS.BUY_PILL: {
      const count = payload && payload.count ? payload.count : 1;
      const bought = buyPills(draft, count);
      if (!bought.ok) throw new Error(bought.reason);
      addLog(draft, '你在洞府丹房购入 ' + bought.bought + ' 枚' + PILL_NAME + '，耗灵石 ' + bought.spent + '。', 'trade');
      return bought;
    }
    case ACTIONS.REST:
      return restHeal(draft, rng);
    case ACTIONS.EXPLORE:
      return startExplore(draft, rng);
    case ACTIONS.CHOOSE:
      return applyChoice(draft, payload.eventId, payload.choiceId, rng);
    case ACTIONS.COMBAT_START:
      return startCombat(draft, payload.enemyId, rng);
    case ACTIONS.COMBAT_TURN:
      return resolveTurn(draft, payload.action, rng);
    default:
      return { ok: false, reason: `未知行动：${action}` };
  }
}

/**
 * @param {object} character 当前角色（不会被修改）
 * @param {string} action 见 ACTIONS
 * @param {function} rng 可注入随机源
 * @param {object} [payload] CHOOSE 需要 { eventId, choiceId }；COMBAT_START 需要 { enemyId }；COMBAT_TURN 只需 { action }
 * @returns {{ok:boolean, error?:string, character:object, action:string, events:Array, detail?:object}}
 */
export function resolveAction(character, action, rng, payload = {}) {
  if (!character) {
    return { ok: false, error: '没有角色', character: null, action, events: [] };
  }

  // P0-5：战斗期间只有「战斗回合」是合法行动
  if (hasActiveCombat(character) && action !== ACTIONS.COMBAT_TURN) {
    return { ok: false, error: '战斗尚未结束，请先完成当前战斗', character, action, events: [] };
  }

  // P0-1：有待处理奇遇时，只有「做选择」是合法行动
  if (hasPendingEvent(character) && action !== ACTIONS.CHOOSE) {
    return {
      ok: false,
      error: '眼前奇遇尚未了结，请先做出选择',
      character,
      action,
      events: [],
    };
  }

  let draft;
  let logBefore;
  let result;
  try {
    draft = structuredClone(character);
    logBefore = draft.log.length;
    result = execute(draft, action, rng, payload);
  } catch (error) {
    return { ok: false, error: `行动结算失败，角色状态未改变（${error.message}）`, character, action, events: [] };
  }

  if (!result || !result.ok) {
    return { ok: false, error: (result && result.reason) || '行动失败', character, action, events: [] };
  }

  const invalid = validateState(draft);
  if (invalid) {
    return { ok: false, error: `结算后状态非法（${invalid}），已回滚`, character, action, events: [] };
  }

  const newEntries = draft.log.slice(logBefore);
  const events = Array.isArray(result.events) && result.events.length
    ? result.events.map((text) => ({ type: action, text, kind: 'info' }))
    : newEntries.map((entry) => ({ type: action, text: entry.text, kind: entry.kind || 'info' }));

  return { ok: true, character: draft, action, events, detail: result };
}





