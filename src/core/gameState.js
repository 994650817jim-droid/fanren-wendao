/**
 * 角色状态：纯数据 + 纯函数，不碰 DOM，方便测试。
 */
import {
  BASE_HP,
  BASE_LIFESPAN,
  START_AGE_YEARS,
  getRoot,
  getTalent,
  rollRoot,
  rollTalent,
} from '../data/backgrounds.js';
import { emptyInventory, normalizeInventory } from './inventory.js';
import { getRealm, totalHpBonus, totalLifespanBonus } from '../data/realms.js';

export const LOG_LIMIT = 60;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 随机一套灵根 + 天赋（创建角色页的「重新随机」用它） */
export function rollBackground(rng) {
  return { root: rollRoot(rng), talent: rollTalent(rng) };
}

export function maxHp(character) {
  const talent = getTalent(character.talentId);
  const hpMult = talent ? talent.hpMult : 1;
  return Math.round(BASE_HP * hpMult) + totalHpBonus(character.realmId);
}

export function lifespanYears(character) {
  return BASE_LIFESPAN + totalLifespanBonus(character.realmId);
}

export function ageYears(character) {
  return character.months / 12;
}

export function isDead(character) {
  return ageYears(character) >= lifespanYears(character);
}

/** 创建角色。rootId / talentId 必须是已存在的 id。 */
export function createCharacter({ name, rootId, talentId }) {
  const root = getRoot(rootId);
  const talent = getTalent(talentId);
  if (!root) throw new Error(`未知灵根: ${rootId}`);
  if (!talent) throw new Error(`未知天赋: ${talentId}`);

  const character = {
    name: (name || '').trim() || '无名散修',
    rootId: root.id,
    talentId: talent.id,
    realmId: 0,
    exp: 0,
    hp: BASE_HP,
    stones: 0,
    months: START_AGE_YEARS * 12,
    pity: {},
    pendingEvent: null,
    victory: false,
    inventory: emptyInventory(),
    story: { flags: {}, seenEvents: [], completedEvents: [] },
    combat: null,
    log: [],
  };
  character.hp = maxHp(character);
  addLog(character, `你以「${root.name}」「${talent.name}」之资，于青云山下踏入仙途。`, 'milestone');
  return character;
}

export function addLog(character, text, kind = 'info') {
  character.log.push({ month: character.months, text, kind });
  if (character.log.length > LOG_LIMIT) {
    character.log.splice(0, character.log.length - LOG_LIMIT);
  }
}

const SEASONS = ['春', '夏', '秋', '冬'];

function toChineseYear(year) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (year < 10) return digits[year];
  if (year < 20) return '十' + (year % 10 === 0 ? '' : digits[year % 10]);
  const tens = Math.floor(year / 10);
  const ones = year % 10;
  return digits[tens] + '十' + (ones === 0 ? '' : digits[ones]);
}

/** 把总月数格式化成「第十八年 · 春」 */
export function timeLabel(character) {
  const year = Math.max(1, Math.floor(character.months / 12));
  const season = SEASONS[Math.floor(character.months % 12 / 3)] || '春';
  return `第${toChineseYear(year)}年 · ${season}`;
}

export function realmName(character) {
  return getRealm(character.realmId).name;
}

/** 修为百分比 0..1 */
export function expPercent(character) {
  const realm = getRealm(character.realmId);
  if (realm.expToNext === null) return 1;
  return clamp(character.exp / realm.expToNext, 0, 1);
}

export function isAtPeak(character) {
  return getRealm(character.realmId).expToNext === null;
}

/** 数值安全检查：把可能越界的属性拉回合法区间 */
export function sanitize(character) {
  character.hp = clamp(Math.round(character.hp), 0, maxHp(character));
  character.stones = Math.max(0, Math.round(character.stones));
  character.months = Math.max(0, Math.round(character.months));
  const realm = getRealm(character.realmId);
  character.exp = Math.round(character.exp);
  if (realm.expToNext !== null) {
    character.exp = clamp(character.exp, 0, realm.expToNext);
  } else {
    character.exp = 0;
  }

  // 保底计数只保留 0..9 的整数，且只对当前境界有意义
  if (!character.pity || typeof character.pity !== 'object' || Array.isArray(character.pity)) {
    character.pity = {};
  }
  const clean = {};
  for (const [key, value] of Object.entries(character.pity)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0 || id > 20) continue;
    if (!Number.isInteger(value) || value <= 0) continue;
    clean[id] = clamp(value, 0, 5);
  }
  character.pity = clean;

  // 待处理奇遇：只接受合法结构，其余一律清空
  const pending = character.pendingEvent;
  if (!pending || typeof pending !== 'object' || typeof pending.eventId !== 'string' || !pending.eventId) {
    character.pendingEvent = null;
  } else {
    character.pendingEvent = {
      eventId: pending.eventId.slice(0, 64),
      atMonth: Number.isFinite(pending.atMonth) ? Math.max(0, Math.round(pending.atMonth)) : character.months,
    };
  }

  // 战斗状态：只接受 active 且字段完整的对象（P0-4）
  const combat = character.combat;
  if (
    !combat ||
    typeof combat !== 'object' ||
    combat.status !== 'active' ||
    typeof combat.enemyId !== 'string' ||
    typeof combat.enemyHp !== 'number' ||
    typeof combat.enemyMaxHp !== 'number' ||
    combat.enemyHp < 0 ||
    combat.enemyMaxHp <= 0
  ) {
    character.combat = null;
  } else {
    combat.enemyMaxHp = Math.round(combat.enemyMaxHp);
    combat.enemyHp = clamp(Math.round(combat.enemyHp), 0, combat.enemyMaxHp);
    combat.round = Number.isInteger(combat.round) && combat.round > 0 ? combat.round : 1;
    combat.cooldown = Number.isInteger(combat.cooldown) && combat.cooldown > 0 ? combat.cooldown : 0;
    if (!Array.isArray(combat.log)) combat.log = [];
  }
  return character;
}






