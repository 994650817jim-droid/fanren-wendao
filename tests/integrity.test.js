/**
 * 状态完整性与概率定义测试（对应评审第 2、3 项）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../src/core/gameState.js';
import { ACTIONS, resolveAction } from '../src/core/actions.js';
import { breakthroughChance, PITY_GUARANTEE } from '../src/core/breakthrough.js';
import { getRealm, MAX_REALM_ID, REALMS } from '../src/data/realms.js';
import { createRng } from '../src/core/rng.js';
import * as Save from '../src/core/saveManager.js';
import { startCombat } from '../src/core/combat.js';

function snapshot(c) {
  return JSON.stringify(c, Object.keys(c).sort());
}

test('无效行动不改变任何状态（原子性）', () => {
  const rng = createRng(42);

  // 修为未满时突破：必须整单失败、状态不变
  const c1 = createCharacter({ name: '甲', rootId: 'triple', talentId: 'plain' });
  const before1 = snapshot(c1);
  const r1 = resolveAction(c1, ACTIONS.BREAKTHROUGH, rng);
  assert.equal(r1.ok, false);
  assert.equal(snapshot(c1), before1, '突破被拒绝时不得修改任何字段');

  // 修为已满时闭关：必须拒绝、状态不变
  const c2 = createCharacter({ name: '乙', rootId: 'triple', talentId: 'plain' });
  c2.exp = getRealm(c2.realmId).expToNext;
  const before2 = snapshot(c2);
  const r2 = resolveAction(c2, ACTIONS.CULTIVATE, rng);
  assert.equal(r2.ok, false);
  assert.equal(snapshot(c2), before2, '闭关被拒绝时不得修改任何字段');

  // 未知行动：不得修改状态
  const c3 = createCharacter({ name: '丙', rootId: 'triple', talentId: 'plain' });
  const before3 = snapshot(c3);
  const r3 = resolveAction(c3, 'teleport', rng);
  assert.equal(r3.ok, false);
  assert.equal(snapshot(c3), before3);
});

test('有效行动一次结算：时间、资源、日志同时变化，不出现半截状态', () => {
  const c = createCharacter({ name: '丁', rootId: 'triple', talentId: 'plain' });
  const rng = createRng(7);
  const monthsBefore = c.months;
  const logBefore = c.log.length;

  const result = resolveAction(c, ACTIONS.CULTIVATE, rng);
  assert.equal(result.ok, true);
  const next = result.character;
  assert.notEqual(next, c, '必须返回新状态而不是就地修改');
  assert.equal(c.months, monthsBefore, '原状态不得被修改');
  assert.equal(next.months, monthsBefore + 3, '时间必须同时推进');
  assert.ok(next.exp > 0, '修为必须同时增加');
  assert.ok(next.log.length > logBefore, '日志必须同时追加');
  assert.ok(result.events.length >= 1, '必须返回结构化事件');
});

test('13 次突破的最终成功率单调不增（唯一权威计算函数）', () => {
  const chances = [];
  for (let realmId = 0; realmId < MAX_REALM_ID; realmId += 1) {
    const c = createCharacter({ name: '概率', rootId: 'triple', talentId: 'plain' });
    c.realmId = realmId;
    c.pity = {};
    chances.push(breakthroughChance(c));
  }
  assert.equal(chances.length, MAX_REALM_ID);
  // 不再额外扣「大境界惩罚」：境界表里的 rate 已经是最终基础值
  for (let i = 1; i < chances.length; i += 1) {
    assert.ok(chances[i] <= chances[i - 1] + 1e-9, `第 ${i} 档成功率 ${chances[i]} 高于前一档 ${chances[i - 1]}`);
  }
  assert.equal(chances[0], 1, '凡人 → 炼气一层必定成功');
  assert.ok(chances[chances.length - 1] >= 0.05, '最低档不得低于 5%');
});

test('境界表里没有重复的「大境界惩罚」字段，避免二次扣减', () => {
  for (const realm of REALMS) {
    assert.equal(Object.prototype.hasOwnProperty.call(realm, 'majorPenalty'), false);
  }
});

test('保底计数达到上限时概率被强制为 100%，且不会被后续计算降低', () => {
  const c = createCharacter({ name: '保底', rootId: 'mixed', talentId: 'plain' });
  c.realmId = 12;
  c.pity = { 12: PITY_GUARANTEE };
  assert.equal(breakthroughChance(c), 1);
  c.pity = { 12: PITY_GUARANTEE - 1 };
  assert.ok(breakthroughChance(c) < 1, '未满保底时不应直接 100%');
});

test('突破成功与失败都会写日志，且失败不会让境界倒退', () => {
  const rng = createRng(99);
  const c = createCharacter({ name: '戊', rootId: 'triple', talentId: 'plain' });
  c.realmId = 5;
  c.exp = getRealm(5).expToNext;
  const beforeRealm = c.realmId;
  const result = resolveAction(c, ACTIONS.BREAKTHROUGH, rng);
  assert.equal(result.ok, true);
  assert.ok(result.events.length >= 1);
  const next = result.character;
  assert.ok(next.realmId >= beforeRealm, '境界不得倒退');
  assert.ok(next.hp >= 1, '气血不得低于 1');
});


test('存在待处理奇遇时，其他行动一律被拒绝（P0-1）', () => {
  const c = createCharacter({ name: '待处理', rootId: 'triple', talentId: 'plain' });
  c.pendingEvent = { eventId: 'herb-gather', atMonth: c.months };
  const before = JSON.stringify(c, Object.keys(c).sort());
  const rng = createRng(9);

  for (const action of [ACTIONS.CULTIVATE, ACTIONS.CONDENSE, ACTIONS.BREAKTHROUGH, ACTIONS.EXPLORE, ACTIONS.COMBAT_START]) {
    const r = resolveAction(c, action, rng, { enemyId: 'iron-wolf' });
    assert.equal(r.ok, false, `${action} 应当被拒绝`);
    assert.match(r.error, /奇遇/);
  }
  assert.equal(JSON.stringify(c, Object.keys(c).sort()), before, '被拒绝时状态不得改变');
});

test('v2 存档可迁移到 v3（补齐 pendingEvent）', () => {
  const c = createCharacter({ name: '旧档', rootId: 'triple', talentId: 'plain' });
  const payload = Save.serialize(c);
  payload.version = 2;
  delete payload.character.pendingEvent;
  const result = Save.deserialize(payload);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.character.pendingEvent, null);
});

test('战斗进行中，其他行动一律被拒绝（P0-5）', () => {
  const c = createCharacter({ name: '战斗中', rootId: 'triple', talentId: 'plain' });
  c.exp = getRealm(0).expToNext;
  const started = startCombat(c, 'iron-wolf', createRng(3));
  assert.equal(started.ok, true);
  const before = JSON.stringify(c, Object.keys(c).sort());
  for (const action of [ACTIONS.CULTIVATE, ACTIONS.CONDENSE, ACTIONS.BREAKTHROUGH, ACTIONS.EXPLORE, ACTIONS.CHOOSE]) {
    const r = resolveAction(c, action, createRng(4), { eventId: 'herb-gather', choiceId: 'dig' });
    assert.equal(r.ok, false, `${action} 在战斗中应被拒绝`);
    assert.match(r.error, /战斗/);
  }
  assert.equal(JSON.stringify(c, Object.keys(c).sort()), before, '被拒绝时状态不得改变');
});

test('开战前置条件：境界不足 / 寿元已尽都被拒绝（P1-1）', () => {
  const lowRealm = createCharacter({ name: '凡人', rootId: 'triple', talentId: 'plain' });
  const r1 = startCombat(lowRealm, 'rogue-spirit', createRng(1));
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /境界不足/);

  const dying = createCharacter({ name: '将尽', rootId: 'triple', talentId: 'plain' });
  dying.months = 200 * 12;
  dying.realmId = 6;
  const r2 = startCombat(dying, 'red-cat', createRng(1));
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /寿元/);
});
