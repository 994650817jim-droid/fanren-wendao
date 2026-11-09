/**
 * 存档：localStorage 自动存档 + 手动存档 + JSON 导入导出 + 逐版本迁移。
 *
 * 规则
 *  - 每个版本有独立迁移函数，旧存档会被升级而不是直接作废。
 *  - 迁移失败或校验不通过时返回错误，绝不覆盖当前游戏状态。
 *  - 导入文本一律当普通数据渲染，不写 innerHTML。
 */
import { REALMS } from '../data/realms.js';
import { SPIRIT_ROOTS, TALENTS } from '../data/backgrounds.js';
import { getEventById } from '../data/events.js';
import { getEnemy } from '../data/enemies.js';
import { getBoss } from '../data/boss.js';
import { normalizeInventory } from './inventory.js';
import { clamp, maxHp, sanitize } from './gameState.js';

export const SAVE_VERSION = 7;
export const SAVE_KEY = 'fanren-wendao:save';

const ROOT_IDS = SPIRIT_ROOTS.map((r) => r.id);
const TALENT_IDS = TALENTS.map((t) => t.id);

/** 每个版本的迁移函数：把 vN 的存档升级到 vN+1 */
const MIGRATIONS = {
  6: (payload) => {
    const pending = payload.character.pendingEvent;
    const seen = pending && typeof pending.eventId === 'string' ? [pending.eventId] : [];
    return {
      ...payload,
      version: 7,
      character: { ...payload.character, story: { flags: {}, seenEvents: seen, completedEvents: [] } },
    };
  },
  5: (payload) => ({
    ...payload,
    version: 6,
    character: { ...payload.character, inventory: normalizeInventory(payload.character.inventory) },
  }),
  4: (payload) => ({
    ...payload,
    version: 5,
    character: { ...payload.character, victory: payload.character.victory === true },
  }),
  3: (payload) => ({
    ...payload,
    version: 4,
    character: { ...payload.character, combat: payload.character.combat && typeof payload.character.combat === 'object' ? payload.character.combat : null },
  }),
  2: (payload) => ({
    ...payload,
    version: 3,
    character: {
      ...payload.character,
      pendingEvent: payload.character.pendingEvent && typeof payload.character.pendingEvent === 'object' ? payload.character.pendingEvent : null,
    },
  }),
  1: (payload) => ({
    ...payload,
    version: 2,
    character: { ...payload.character, pity: payload.character.pity && typeof payload.character.pity === 'object' ? payload.character.pity : {} },
  }),
};

/** 把任意版本的存档升级到当前版本；无法升级时返回 null */
export function migrate(payload) {
  if (!payload || typeof payload !== 'object') return null;
  let current = payload;
  let guard = 0;
  while (current.version !== SAVE_VERSION) {
    const step = MIGRATIONS[current.version];
    if (!step || guard > 10) return null;
    current = step(current);
    guard += 1;
  }
  return current;
}

export function serialize(character, savedAt = new Date().toISOString()) {
  return {
    version: SAVE_VERSION,
    savedAt,
    character: {
      name: character.name,
      rootId: character.rootId,
      talentId: character.talentId,
      realmId: character.realmId,
      exp: character.exp,
      hp: character.hp,
      stones: character.stones,
      months: character.months,
      pity: { ...(character.pity || {}) },
      pendingEvent: character.pendingEvent ? { ...character.pendingEvent } : null,
      combat: character.combat ? { ...character.combat } : null,
      victory: character.victory === true,
      inventory: normalizeInventory(character.inventory),
      story: {
        flags: { ...(character.story && character.story.flags ? character.story.flags : {}) },
        seenEvents: [...((character.story && character.story.seenEvents) || [])],
        completedEvents: [...((character.story && character.story.completedEvents) || [])],
      },
      log: character.log.slice(-30).map((entry) => ({
        month: entry.month,
        text: entry.text,
        kind: entry.kind || 'info',
      })),
    },
  };
}

/** 战斗存档的完整校验：敌人必须真实存在，关键字段齐全且自洽 */
function validateCombat(combat) {
  if (typeof combat !== 'object' || Array.isArray(combat)) return 'combat 字段格式错误';
  if (combat.status !== 'active') return 'combat 状态非法';
  if (typeof combat.id !== 'string' || combat.id.length === 0) return 'combat 缺少 id';
  if (typeof combat.enemyId !== 'string' || (!getEnemy(combat.enemyId) && !getBoss(combat.enemyId))) return 'combat 敌人不存在';
  const numeric = ['enemyHp', 'enemyMaxHp', 'enemyAtk', 'enemyDef', 'rewardStones', 'rewardExpRatio', 'round', 'cooldown'];
  for (const key of numeric) {
    if (!isFiniteNumber(combat[key])) return 'combat 字段 ' + key + ' 非法';
  }
  if (combat.enemyMaxHp <= 0) return 'combat 敌人气血上限非法';
  if (combat.enemyHp < 0 || combat.enemyHp > combat.enemyMaxHp) return 'combat 敌人气血越界';
  if (!Number.isInteger(combat.round) || combat.round < 1 || combat.round > 60) return 'combat 回合数非法';
  const bossDef = getBoss(combat.enemyId);
  if (Boolean(bossDef) !== (combat.isBoss === true)) {
    return 'combat 敌人类型与 Boss 标记不一致';
  }
  if (combat.isBoss) {
    if (combat.phase !== 1 && combat.phase !== 2) return 'combat Boss 阶段非法';
    if (typeof combat.telegraph !== 'boolean') return 'combat 预警状态非法';
    if (!isFiniteNumber(combat.residualThunder) || combat.residualThunder < 0) return 'combat 余雷数值非法';
    if (typeof combat.counterBonus !== 'boolean') return 'combat 反击标记非法';
    if (combat.thunderStats !== undefined) {
      const ts = combat.thunderStats;
      if (typeof ts !== 'object' || ts === null) return 'combat 雷霆统计非法';
      for (const key of ['warned', 'defended', 'missed', 'recovered']) {
        if (!Number.isInteger(ts[key]) || ts[key] < 0) return 'combat 雷霆统计字段非法：' + key;
      }
    }
  }
  for (const key of ['enemyAtk', 'enemyDef', 'rewardStones']) {
    if (!Number.isInteger(combat[key]) || combat[key] < 0 || combat[key] > 100000) return 'combat 字段 ' + key + ' 越界';
  }
  if (combat.rewardExpRatio < 0 || combat.rewardExpRatio > 1) return 'combat 修为奖励比例非法';
  if (!Number.isInteger(combat.enemyHp) || combat.enemyHp <= 0) return 'combat 敌人气血必须为正整数';
  if (!Number.isInteger(combat.cooldown) || combat.cooldown < 0 || combat.cooldown > 3) return 'combat 冷却非法';
  return null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 校验（会先做版本迁移）。ok=false 时 error 为可直接展示给玩家的中文原因。
 * @returns {{ok:boolean, error?:string, data?:object, migrated?:boolean}}
 */
export function validate(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { ok: false, error: '存档内容不是一个对象' };
  }
  const migrated = migrate(rawPayload);
  if (!migrated) {
    return { ok: false, error: `存档版本不兼容（当前支持 v1~v${SAVE_VERSION}，实际 v${rawPayload.version ?? '未知'}）` };
  }
  const c = migrated.character;
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, error: '存档缺少 character 字段' };
  }
  if (typeof c.name !== 'string' || c.name.trim().length === 0) {
    return { ok: false, error: '角色名缺失或为空' };
  }
  if (c.name.length > 24) {
    return { ok: false, error: '角色名过长（最多 24 字）' };
  }
  if (!ROOT_IDS.includes(c.rootId)) {
    return { ok: false, error: `未知灵根：${c.rootId}` };
  }
  if (!TALENT_IDS.includes(c.talentId)) {
    return { ok: false, error: `未知天赋：${c.talentId}` };
  }
  if (!Number.isInteger(c.realmId) || c.realmId < 0 || c.realmId >= REALMS.length) {
    return { ok: false, error: `境界 id 非法：${c.realmId}` };
  }
  for (const key of ['exp', 'hp', 'stones', 'months']) {
    if (!isFiniteNumber(c[key])) {
      return { ok: false, error: `字段 ${key} 不是有效数字` };
    }
    if (c[key] < 0) {
      return { ok: false, error: `字段 ${key} 不能为负数` };
    }
  }
  const realm = REALMS[c.realmId];
  if (realm.expToNext !== null && c.exp > realm.expToNext) {
    return { ok: false, error: '修为超过当前境界上限' };
  }
  if (c.hp > maxHp({ talentId: c.talentId, realmId: c.realmId }) + 1) {
    return { ok: false, error: '气血超过上限' };
  }
  if (c.months > 2000 * 12) {
    return { ok: false, error: '角色年龄超出合理范围' };
  }
  if (c.log !== undefined && !Array.isArray(c.log)) {
    return { ok: false, error: 'log 字段格式错误' };
  }
  if (c.pity !== undefined && (typeof c.pity !== 'object' || Array.isArray(c.pity))) {
    return { ok: false, error: 'pity 字段格式错误' };
  }
  if (c.pity !== undefined) {
    for (const [key, value] of Object.entries(c.pity)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0 || id > 20) return { ok: false, error: 'pity 键非法' };
      if (!Number.isInteger(value) || value < 0 || value > 5) return { ok: false, error: 'pity 计数非法' };
    }
  }
  if (c.inventory !== undefined && (typeof c.inventory !== 'object' || c.inventory === null)) {
    return { ok: false, error: 'inventory 字段格式错误' };
  }
  if (typeof c.victory !== 'undefined' && typeof c.victory !== 'boolean') return { ok: false, error: 'victory 字段必须是布尔值' };
  if (c.pendingEvent && c.combat) {
    return { ok: false, error: '存档同时存在待处理奇遇与战斗，状态冲突' };
  }
  if (c.combat !== undefined && c.combat !== null) {
    const combatError = validateCombat(c.combat);
    if (combatError) return { ok: false, error: combatError };
  }
  if (c.pendingEvent !== undefined && c.pendingEvent !== null) {
    if (typeof c.pendingEvent !== 'object' || Array.isArray(c.pendingEvent)) {
      return { ok: false, error: 'pendingEvent 字段格式错误' };
    }
    if (typeof c.pendingEvent.eventId !== 'string' || c.pendingEvent.eventId.length === 0) {
      return { ok: false, error: 'pendingEvent 缺少 eventId' };
    }
  }
  for (const key of ['exp', 'hp', 'stones', 'months']) {
    if (Number.isInteger(c[key]) === false) {
      return { ok: false, error: '字段 ' + key + ' 必须是整数' };
    }
  }
  if (c.stones > 1000000) {
    return { ok: false, error: '灵石数量超出合理范围' };
  }
  return { ok: true, data: migrated, migrated: rawPayload.version !== SAVE_VERSION };
}

/** 校验后清洗成可直接使用的角色对象 */
export function deserialize(rawPayload) {
  const result = validate(rawPayload);
  if (!result.ok) return result;
  const c = result.data.character;

  const pity = {};
  if (c.pity && typeof c.pity === 'object') {
    for (const [key, value] of Object.entries(c.pity)) {
      const id = Number(key);
      if (Number.isInteger(id) && id >= 0 && id <= 20 && Number.isInteger(value) && value > 0) {
        pity[id] = clamp(value, 0, 5);
      }
    }
  }

  const character = {
    name: c.name.trim(),
    rootId: c.rootId,
    talentId: c.talentId,
    realmId: c.realmId,
    exp: c.exp,
    hp: c.hp,
    stones: c.stones,
    months: c.months,
    pity,
    pendingEvent: sanitizePendingEvent(c),
    combat: c.combat && typeof c.combat === 'object' ? { ...c.combat } : null,
    victory: c.victory === true,
    inventory: normalizeInventory(c.inventory),
    story: {
      flags: c.story && c.story.flags && typeof c.story.flags === 'object' ? { ...c.story.flags } : {},
      seenEvents: c.story && Array.isArray(c.story.seenEvents) ? c.story.seenEvents.filter((id) => typeof id === 'string') : [],
      completedEvents: c.story && Array.isArray(c.story.completedEvents) ? c.story.completedEvents.filter((id) => typeof id === 'string') : [],
    },
    log: Array.isArray(c.log)
      ? c.log
          .filter((e) => e && typeof e.text === 'string' && isFiniteNumber(e.month))
          .map((e) => ({
            month: clamp(Math.round(e.month), 0, c.months),
            text: e.text.slice(0, 200),
            kind: typeof e.kind === 'string' ? e.kind : 'info',
          }))
      : [],
  };
  sanitize(character);
  return { ok: true, character, migrated: result.migrated };
}

/** 非法/失效的待处理奇遇直接清掉，避免存档把角色卡死 */
function sanitizePendingEvent(c) {
  const pending = c.pendingEvent;
  if (!pending || typeof pending !== 'object') return null;
  const event = getEventById(pending.eventId);
  if (!event) return null;
  if (event.minRealm > c.realmId) return null;
  const atMonth = Number.isFinite(pending.atMonth) ? Math.round(pending.atMonth) : c.months;
  if (atMonth > c.months) return null;
  return { eventId: event.id, atMonth };
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveToStorage(character, storage = defaultStorage()) {
  if (!storage) return { ok: false, error: '当前环境不支持 localStorage' };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(serialize(character)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `写入存档失败：${error.message}` };
  }
}

export function hasSave(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function readRawSave(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    return storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}

export function loadFromStorage(storage = defaultStorage()) {
  const raw = readRawSave(storage);
  if (raw === null) return { ok: false, error: '没有找到存档' };
  return parseSaveText(raw);
}

export function clearSave(storage = defaultStorage()) {
  if (!storage) return { ok: false, error: '当前环境不支持 localStorage' };
  try {
    storage.removeItem(SAVE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** 供「导出 JSON」使用 */
export function exportToJson(character) {
  return JSON.stringify(serialize(character), null, 2);
}

/** 供「导入 JSON」使用：先 JSON.parse，再迁移 + 校验 */
export function parseSaveText(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  return deserialize(payload);
}












