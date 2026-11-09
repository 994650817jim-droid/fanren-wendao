import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, maxHp } from '../src/core/gameState.js';
import { attemptBreakthrough, breakthroughChance, canBreakthrough } from '../src/core/breakthrough.js';
import { getRealm } from '../src/data/realms.js';

function rngWith(chanceResult) {
  const rng = () => 0.5;
  rng.float = () => 0.5;
  rng.range = (a, b) => (a + b) / 2;
  rng.int = (a, b) => Math.floor((a + b) / 2);
  rng.chance = () => chanceResult;
  rng.pick = (arr) => arr[0];
  return rng;
}

function readyChar(rootId = 'triple', talentId = 'plain') {
  const c = createCharacter({ name: '突破测试', rootId, talentId });
  c.exp = getRealm(c.realmId).expToNext;
  return c;
}

test('修为未满不能突破', () => {
  const c = createCharacter({ name: '甲', rootId: 'triple', talentId: 'plain' });
  const check = canBreakthrough(c);
  assert.equal(check.ok, false);
  assert.ok(check.reasons.length > 0);
  const result = attemptBreakthrough(c, rngWith(true));
  assert.equal(result.ok, false);
});

test('凡人突破炼气一层必定成功，修为清零，气血上限提升', () => {
  const c = readyChar();
  const result = attemptBreakthrough(c, rngWith(true));
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(c.realmId, 1);
  assert.equal(c.exp, 0);
  assert.equal(maxHp(c), 110);
  assert.ok(c.log.some((e) => e.kind === 'milestone'));
});

test('突破失败：按上限的 25% 扣修为、扣两成气血、耗半年，但不致死', () => {
  const c = readyChar();
  c.realmId = 5;
  const cap = getRealm(5).expToNext;
  c.exp = cap;
  c.hp = 30;
  const monthsBefore = c.months;
  const result = attemptBreakthrough(c, rngWith(false));
  assert.equal(result.success, false);
  assert.equal(c.realmId, 5, '失败不应改变境界');
  assert.equal(c.exp, cap - Math.floor(cap * 0.25));
  assert.equal(c.hp, 24);
  assert.equal(c.months, monthsBefore + 6);
  assert.ok(c.hp >= 1, '气血保底为 1');
});

test('气血极低时失败也不会降到 1 以下', () => {
  const c = readyChar();
  c.realmId = 9;
  c.exp = getRealm(9).expToNext;
  c.stones = getRealm(9).costStones;
  c.hp = 1;
  const result = attemptBreakthrough(c, rngWith(false));
  assert.equal(result.success, false);
  assert.equal(c.hp, 1);
});

test('灵石不足不能突破，并提示去凝灵', () => {
  const c = readyChar();
  c.realmId = 9;
  c.exp = getRealm(9).expToNext;
  c.stones = 0;
  const check = canBreakthrough(c);
  assert.equal(check.ok, false);
  assert.ok(check.reasons.some((r) => r.includes('灵石')));
});

test('突破成功率 = 基础 + 天赋，且夹在 5%~100%', () => {
  const plain = readyChar('triple', 'plain');
  assert.ok(Math.abs(breakthroughChance(plain) - 1.0) < 1e-9, '凡人基础成功率 100%');

  const fortune = readyChar('triple', 'fortune');
  fortune.realmId = 9;
  const expected = getRealm(9).rate + 0.05;
  assert.ok(Math.abs(breakthroughChance(fortune) - Math.min(1, expected)) < 1e-9);

  const capped = readyChar('triple', 'fortune');
  capped.realmId = 12;
  assert.ok(breakthroughChance(capped) <= 1);
});

test('灵石按境界表扣除', () => {
  const c = readyChar();
  c.realmId = 9;
  c.exp = getRealm(9).expToNext;
  const cost = getRealm(9).costStones;
  c.stones = cost + 50;
  const result = attemptBreakthrough(c, rngWith(true));
  assert.equal(result.success, true);
  assert.equal(c.stones, 50);
  assert.equal(c.realmId, 10);
});

test('终点境界不能突破', () => {
  const c = createCharacter({ name: '乙', rootId: 'triple', talentId: 'plain' });
  c.realmId = 13;
  const check = canBreakthrough(c);
  assert.equal(check.ok, false);
});
