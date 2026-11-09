/**
 * 外出历练：阶段二的资源主来源 + 随机奇遇。
 *
 * 生命周期约束（对应源码评审 P0-1）
 *  - 历练抽到奇遇后，必须把待处理奇遇写进角色状态 character.pendingEvent。
 *  - 存在待处理奇遇时，不允许再做任何会改变结算前提的行动（历练/闭关/凝灵/突破/战斗）。
 *  - 选择必须核对 pendingEvent.eventId，结算成功一次后立即清空，无法重复领取。
 *  - 刷新页面后从存档恢复，仍必须先处理该奇遇。
 *  - 所有行动都在 clone 出来的 draft 上执行（见 actions.js），失败即整体丢弃。
 */
import { getRealm } from '../data/realms.js';
import { pickEvent, getEventById } from '../data/events.js';
import { addLog, clamp, isDead, maxHp, sanitize } from './gameState.js';

export const EXPLORE_MONTHS = 3;
export const EXPLORE_BASE_STONES = 4;

/** 有没有未处理的奇遇 */
export function hasPendingEvent(character) {
  return Boolean(character && character.pendingEvent && character.pendingEvent.eventId);
}

export function startExplore(character, rng) {
  if (isDead(character)) {
    return { ok: false, reason: '寿元已尽', months: 0, stones: 0, event: null, died: true };
  }
  if (hasPendingEvent(character)) {
    return { ok: false, reason: '眼前的奇遇尚未了结，先做选择', months: 0, stones: 0, event: null, died: false };
  }

  // 先判定寿元，再结算收益，避免「寿尽仍拿奖励」
  const stones = EXPLORE_BASE_STONES + rng.int(0, 3);
  character.stones += stones;
  character.months += EXPLORE_MONTHS;
  addLog(character, `下山历练三月，得灵石 +${stones}。`, 'cultivate');

  const event = pickEvent(character, rng);
  if (!event) {
    sanitize(character);
    return { ok: true, months: EXPLORE_MONTHS, stones, event: null, died: isDead(character) };
  }

  // 写入待处理奇遇：这是唯一合法领取入口
  character.pendingEvent = { eventId: event.id, atMonth: character.months };
  recordSeen(character, event.id);
  addLog(character, `途中遇到「${event.title}」。`, 'omen');
  sanitize(character);
  return { ok: true, months: EXPLORE_MONTHS, stones, event, died: isDead(character) };
}

/** 结算待处理奇遇。必须是 pendingEvent 记录的那一条。 */
export function applyChoice(character, eventId, choiceId, rng) {
  if (!hasPendingEvent(character)) {
    return { ok: false, reason: '当前没有待处理的奇遇', deltas: null };
  }
  if (character.pendingEvent.eventId !== eventId) {
    return { ok: false, reason: '奇遇不匹配，无法结算', deltas: null };
  }
  if (isDead(character)) {
    return { ok: false, reason: '寿元已尽', deltas: null };
  }

  const event = getEventById(eventId);
  if (!event) return { ok: false, reason: '奇遇不存在', deltas: null };
  if (character.realmId < event.minRealm) {
    return { ok: false, reason: '境界不足，无法应对此奇遇', deltas: null };
  }
  const choice = event.choices.find((item) => item.id === choiceId);
  if (!choice) return { ok: false, reason: '选项不存在', deltas: null };

  const outcome = pickOutcome(choice, rng);
  const deltas = applyEffects(character, outcome.effects || [], rng);

  character.pendingEvent = null;
  recordCompleted(character, eventId);
  const flags = { ...(event.flags || {}), ...(choice.flags || {}), ...(outcome.flags || {}) };
  for (const [key, value] of Object.entries(flags)) {
    if (typeof key === 'string') character.story.flags[key] = value;
  }
  addLog(character, `${event.title} · ${outcome.text}`, outcome.effects && outcome.effects.length ? 'milestone' : 'info');
  sanitize(character);

  return {
    ok: true,
    eventId,
    choiceId,
    outcome: { text: outcome.text },
    deltas,
    died: isDead(character),
  };
}

function pickOutcome(choice, rng) {
  const outcomes = choice.outcomes || [];
  const total = outcomes.reduce((sum, outcome) => sum + (outcome.weight || 0), 0);
  if (outcomes.length === 0 || total <= 0) {
    return { weight: 1, text: '什么也没有发生。', effects: [] };
  }
  let roll = rng.float() * total;
  for (const outcome of outcomes) {
    roll -= outcome.weight || 0;
    if (roll <= 0) return outcome;
  }
  return outcomes[outcomes.length - 1];
}

function applyEffects(character, effects, rng) {
  const deltas = { exp: 0, stones: 0, hp: 0, months: 0, items: 0 };
  const realm = getRealm(character.realmId);
  const cap = realm.expToNext === null ? 0 : realm.expToNext;
  const hpMax = maxHp(character);

  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') continue;
    switch (effect.type) {
      case 'exp': {
        if (!cap) break;
        const raw = Math.round(cap * effect.ratio * rng.range(0.9, 1.1));
        const before = character.exp;
        character.exp = clamp(character.exp + raw, 0, cap);
        deltas.exp += character.exp - before;
        break;
      }
      case 'stones': {
        const value = Math.round(effect.value * rng.range(0.9, 1.1));
        const before = character.stones;
        character.stones = Math.max(0, character.stones + value);
        deltas.stones += character.stones - before;
        break;
      }
      case 'hp': {
        const raw = Math.round(hpMax * effect.ratio);
        const before = character.hp;
        character.hp = clamp(character.hp + raw, 1, hpMax);
        deltas.hp += character.hp - before;
        break;
      }
      case 'months': {
        const value = Math.max(0, Math.round(effect.value));
        character.months += value;
        deltas.months += value;
        break;
      }
      case 'item': {
        const count = Math.max(0, Math.floor(Number(effect.count) || 0));
        if (!count) break;
        character.inventory = character.inventory || { healingPill: 0 };
        const have = Number(character.inventory[effect.id]) || 0;
        character.inventory[effect.id] = have + count;
        deltas.items = (deltas.items || 0) + count;
        break;
      }
      default:
        break;
    }
  }
  return deltas;
}


/* ---------------- 剧情状态（对应 ChatGPT v0.16） ---------------- */
function ensureStory(character) {
  if (!character.story || typeof character.story !== 'object') {
    character.story = { flags: {}, seenEvents: [], completedEvents: [] };
  }
  if (!Array.isArray(character.story.seenEvents)) character.story.seenEvents = [];
  if (!Array.isArray(character.story.completedEvents)) character.story.completedEvents = [];
  if (!character.story.flags || typeof character.story.flags !== 'object') character.story.flags = {};
  return character.story;
}

export function recordSeen(character, eventId) {
  const story = ensureStory(character);
  if (!story.seenEvents.includes(eventId)) story.seenEvents.push(eventId);
}

export function recordCompleted(character, eventId) {
  const story = ensureStory(character);
  if (!story.completedEvents.includes(eventId)) story.completedEvents.push(eventId);
}

export function hasFlag(character, key) {
  return Boolean(ensureStory(character).flags[key]);
}

export function getStory(character) {
  return ensureStory(character);
}
