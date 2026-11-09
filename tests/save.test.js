import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../src/core/gameState.js';
import * as Save from '../src/core/saveManager.js';

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

function sample() {
  const c = createCharacter({ name: '青衫客', rootId: 'dual', talentId: 'genius' });
  c.exp = 42;
  c.stones = 7;
  return c;
}

test('存档序列化 → 校验 → 反序列化，数据不丢', () => {
  const c = sample();
  const payload = Save.serialize(c);
  assert.equal(payload.version, Save.SAVE_VERSION);
  const result = Save.deserialize(payload);
  assert.equal(result.ok, true);
  assert.equal(result.character.name, '青衫客');
  assert.equal(result.character.rootId, 'dual');
  assert.equal(result.character.talentId, 'genius');
  assert.equal(result.character.exp, 42);
  assert.equal(result.character.stones, 7);
  assert.equal(result.character.realmId, 0);
});

test('localStorage 存读一致', () => {
  const storage = memStorage();
  const c = sample();
  assert.equal(Save.hasSave(storage), false);
  assert.equal(Save.saveToStorage(c, storage).ok, true);
  assert.equal(Save.hasSave(storage), true);

  const loaded = Save.loadFromStorage(storage);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.character.name, '青衫客');
  assert.equal(loaded.character.exp, 42);

  assert.equal(Save.clearSave(storage).ok, true);
  assert.equal(Save.hasSave(storage), false);
  assert.equal(Save.loadFromStorage(storage).ok, false);
});

test('非法 JSON 被拒绝', () => {
  const result = Save.parseSaveText('这不是 JSON {{{');
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON/);
});

test('版本不匹配被拒绝', () => {
  const payload = Save.serialize(sample());
  payload.version = 999;
  const result = Save.validate(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /版本/);
});

test('未知灵根 / 未知天赋被拒绝', () => {
  const payload = Save.serialize(sample());
  payload.character.rootId = 'ultra-heaven';
  assert.equal(Save.validate(payload).ok, false);

  const payload2 = Save.serialize(sample());
  payload2.character.talentId = 'god';
  assert.equal(Save.validate(payload2).ok, false);
});

test('负数与非法数值被拒绝', () => {
  const payload = Save.serialize(sample());
  payload.character.stones = -5;
  const result = Save.validate(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /负数|不能为负/);

  const payload2 = Save.serialize(sample());
  payload2.character.hp = Number.NaN;
  assert.equal(Save.validate(payload2).ok, false);

  const payload3 = Save.serialize(sample());
  payload3.character.hp = '一万';
  assert.equal(Save.validate(payload3).ok, false);
});

test('修为超过境界上限被拒绝', () => {
  const payload = Save.serialize(sample());
  payload.character.exp = 100000;
  const result = Save.validate(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /修为/);
});

test('空对象 / null / 数组被拒绝', () => {
  assert.equal(Save.validate(null).ok, false);
  assert.equal(Save.validate({}).ok, false);
  assert.equal(Save.validate([]).ok, false);
});

test('角色名缺失被拒绝', () => {
  const payload = Save.serialize(sample());
  payload.character.name = '   ';
  assert.equal(Save.validate(payload).ok, false);
});

test('日志里的脏数据会被过滤，不会撑破界面', () => {
  const c = sample();
  c.log.push({ month: 1, text: '正常记录', kind: 'info' });
  const payload = Save.serialize(c);
  payload.character.log.push({ month: 'x', text: '坏数据' });
  payload.character.log.push({ text: '缺 month' });
  const result = Save.deserialize(payload);
  assert.equal(result.ok, true);
  assert.ok(result.character.log.every((e) => typeof e.text === 'string' && Number.isFinite(e.month)));
});

test('导出 JSON 可以再次导入', () => {
  const c = sample();
  const text = Save.exportToJson(c);
  const result = Save.parseSaveText(text);
  assert.equal(result.ok, true);
  assert.equal(result.character.name, '青衫客');
  assert.equal(result.character.exp, 42);
});

test('v1 旧存档可以迁移到当前版本', () => {
  const c = sample();
  const v2 = Save.serialize(c);
  // 伪造一份 v1 存档：没有 pity 字段，版本号为 1
  const v1 = {
    version: 1,
    savedAt: v2.savedAt,
    character: { ...v2.character },
  };
  delete v1.character.pity;

  const result = Save.deserialize(v1);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.deepEqual(result.character.pity, {}, '迁移后应补齐 pity 字段');
  assert.equal(result.character.name, '青衫客');

  // 迁移必须不改动原始数据
  assert.equal(v1.version, 1);
  assert.equal(v1.character.pity, undefined);
});

test('保底计数会写进存档并读回', () => {
  const c = sample();
  c.realmId = 3;
  c.pity = { 3: 2 };
  const payload = Save.serialize(c);
  assert.equal(payload.version, Save.SAVE_VERSION);
  const result = Save.deserialize(payload);
  assert.equal(result.ok, true);
  assert.equal(result.character.pity[3], 2);
});

test('保底计数必须落在 0~5，越界存档被拒绝（不再静默夹值）', () => {
  const c = sample();
  c.pity = { 3: 99 };
  assert.equal(Save.validate(Save.serialize(c)).ok, false, '超过上限必须拒绝');
  c.pity = { 3: 2, 4: 0 };
  assert.equal(Save.validate(Save.serialize(c)).ok, true, '合法区间应当通过');
  c.pity = { 3: -1 };
  assert.equal(Save.validate(Save.serialize(c)).ok, false, '负数必须拒绝');
  c.pity = { 3: 1.5 };
  assert.equal(Save.validate(Save.serialize(c)).ok, false, '非整数必须拒绝');
});

test('待处理奇遇会写进存档并读回（P0-1）', () => {
  const c = sample();
  c.realmId = 1;
  c.pendingEvent = { eventId: 'herb-gather', atMonth: c.months };
  const payload = Save.serialize(c);
  assert.equal(payload.version, Save.SAVE_VERSION);
  const result = Save.deserialize(payload);
  assert.equal(result.ok, true);
  assert.equal(result.character.pendingEvent.eventId, 'herb-gather');
});

test('pendingEvent 结构非法时拒绝导入', () => {
  const c = sample();
  const payload = Save.serialize(c);
  payload.character.pendingEvent = { eventId: '' };
  assert.equal(Save.validate(payload).ok, false);
  payload.character.pendingEvent = 'not-an-object';
  assert.equal(Save.validate(payload).ok, false);
});


