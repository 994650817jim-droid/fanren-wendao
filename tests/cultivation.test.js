import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, expPercent, isAtPeak, maxHp, timeLabel } from '../src/core/gameState.js';
import { CULTIVATE_MONTHS, condenseSpirit, cultivate } from '../src/core/cultivation.js';
import { getRealm } from '../src/data/realms.js';
import { ACTIONS, resolveAction } from '../src/core/actions.js';

/** 固定随机源：range 取中值，chance 恒为 false（不触发奇遇） */
function midRng() {
  const rng = () => 0.5;
  rng.float = () => 0.5;
  rng.range = (a, b) => (a + b) / 2;
  rng.int = (a, b) => Math.floor((a + b) / 2);
  rng.chance = () => false;
  rng.pick = (arr) => arr[0];
  return rng;
}

function newChar(rootId = 'triple', talentId = 'plain') {
  return createCharacter({ name: '测试散修', rootId, talentId });
}

test('闭关 3 个月，只涨修为，不涨灵石', () => {
  const c = newChar();
  const result = cultivate(c, midRng());
  assert.equal(result.ok, true);
  // 凡人：perMonth 8 × 三灵根 1.0 × 资质平平 1.0 × 3 月 = 24
  assert.equal(result.gained, 24);
  assert.equal(c.exp, 24);
  assert.equal(c.stones, 0, '闭关不应产出灵石');
  assert.equal(c.months, 16 * 12 + CULTIVATE_MONTHS);
});

test('修为满了之后闭关被拒绝（不再空转）', () => {
  const c = newChar();
  for (let i = 0; i < 50; i += 1) cultivate(c, midRng());
  assert.equal(c.exp, getRealm(c.realmId).expToNext);
  const again = cultivate(c, midRng());
  assert.equal(again.ok, false);
  assert.match(again.reason, /修为已满/);
  assert.equal(c.exp, getRealm(c.realmId).expToNext, '被拒绝时状态不变');
});

test('修为不会超过当前境界上限', () => {
  const c = newChar();
  for (let i = 0; i < 50; i += 1) cultivate(c, midRng());
  assert.equal(expPercent(c), 1);
});

test('凝灵吐纳产灵石、不产修为，并消耗时间', () => {
  const c = newChar();
  const monthsBefore = c.months;
  const result = condenseSpirit(c, midRng());
  assert.equal(result.ok, true);
  assert.ok(result.stones >= 1);
  assert.equal(c.stones, result.stones);
  assert.equal(c.exp, 0, '凝灵不应产出修为');
  assert.equal(c.months, monthsBefore + CULTIVATE_MONTHS);
});

test('灵根只影响修炼，不影响凝灵收益（避免双重劣势）', () => {
  const fast = newChar('heaven', 'genius');
  const slow = newChar('mixed', 'plain');
  assert.ok(cultivate(fast, midRng()).gained > cultivate(slow, midRng()).gained);
  assert.equal(condenseSpirit(fast, midRng()).stones, condenseSpirit(slow, midRng()).stones);
});

test('寿元随境界提升，时间标签正常', () => {
  const c = newChar();
  assert.equal(maxHp(c), 100);
  assert.match(timeLabel(c), /第十六年/);
  c.months += 12;
  assert.match(timeLabel(c), /第十七年/);
});

test('已达金丹初期后不可再闭关，也不再是终点判定错误', () => {
  const c = newChar();
  c.realmId = 13;
  assert.equal(isAtPeak(c), true);
  const result = cultivate(c, midRng());
  assert.equal(result.ok, false);
  assert.equal(result.capped, true);
});

test('统一结算入口 resolveAction 返回结构化事件', () => {
  const c = newChar();
  const result = resolveAction(c, ACTIONS.CULTIVATE, midRng());
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.events));
  assert.ok(result.events.length >= 1);
  assert.equal(result.events[0].type, 'cultivate');
  assert.ok(result.events[0].text.includes('修为'));

  const bad = resolveAction(c, 'no-such-action', midRng());
  assert.equal(bad.ok, false);
  assert.match(bad.error, /未知行动/);
});

