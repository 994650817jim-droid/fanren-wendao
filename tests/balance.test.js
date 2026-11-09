/**
 * 平衡与经济不变量测试。
 *
 * 核心命题（评审要求）：
 *  1. 修为满、灵石不足时，必须始终存在一个「可以继续赚钱且不致死」的行动 → 不允许经济软锁
 *  2. 上千个固定随机种子下，各类组合都能通关且不寿尽
 *  3. 连续突破失败有软保底，不会无限卡关
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, ageYears, isDead, lifespanYears } from '../src/core/gameState.js';
import { condenseSpirit, cultivate } from '../src/core/cultivation.js';
import { attemptBreakthrough, canBreakthrough, breakthroughChance, PITY_GUARANTEE } from '../src/core/breakthrough.js';
import { MAX_REALM_ID, getRealm, totalMonthsToPeak } from '../src/data/realms.js';
import { createRng } from '../src/core/rng.js';

/** 用真实随机源跑一整局，记录统计 */
function playFullGame(rootId, talentId, seed) {
  const rng = createRng(seed);
  const c = createCharacter({ name: `sim-${seed}`, rootId, talentId });
  const stats = { cultivations: 0, condenses: 0, breakthroughs: 0, fails: 0, months: 0, maxAge: 0, dead: false };

  for (let step = 0; step < 20000; step += 1) {
    if (c.realmId >= MAX_REALM_ID) break;
    const check = canBreakthrough(c);
    if (check.ok) {
      const result = attemptBreakthrough(c, rng);
      stats.breakthroughs += 1;
      if (!result.success) stats.fails += 1;
    } else if (c.exp >= (getRealm(c.realmId).expToNext || 0)) {
      // 修为已满但灵石不足：唯一合法解法是凝灵，且必须不会致死
      assert.equal(isDead(c), false, '允许被经济卡住，但不允许被卡死');
      const result = condenseSpirit(c, rng);
      assert.equal(result.ok, true, '凝灵必须永远可用');
      stats.condenses += 1;
    } else {
      const result = cultivate(c, rng);
      assert.equal(result.ok, true, '闭关应当可用');
      stats.cultivations += 1;
    }
    if (isDead(c)) {
      stats.dead = true;
      break;
    }
  }
  stats.months = c.months - 16 * 12;
  stats.maxAge = ageYears(c);
  stats.realmId = c.realmId;
  stats.stones = c.stones;
  return { c, stats };
}

test('经济不变量：修为满而灵石不足时，凝灵永远可用且不致死', () => {
  const c = createCharacter({ name: '卡关', rootId: 'heaven', talentId: 'genius' });
  c.realmId = 9;
  c.exp = getRealm(9).expToNext;
  c.stones = 0;
  const check = canBreakthrough(c);
  assert.equal(check.ok, false);
  assert.ok(check.reasons.some((r) => r.includes('灵石')));

  const rng = createRng(12345);
  const result = condenseSpirit(c, rng);
  assert.equal(result.ok, true);
  assert.ok(c.stones > 0);
  assert.equal(isDead(c), false);
});

test('1000 个固定种子 × 最差组合：全部通关，无寿尽', () => {
  let deadCount = 0;
  let softlock = 0;
  let maxMonths = 0;
  let totalFails = 0;

  for (let seed = 1; seed <= 1000; seed += 1) {
    const { stats, c } = playFullGame('mixed', 'plain', seed);
    if (stats.dead) deadCount += 1;
    if (c.realmId < MAX_REALM_ID) softlock += 1;
    maxMonths = Math.max(maxMonths, stats.months);
    totalFails += stats.fails;
  }

  assert.equal(deadCount, 0, '不应有寿尽结束的局');
  assert.equal(softlock, 0, '不应有无法通关的局');
  assert.ok(maxMonths / 12 < 90, `单局最长 ${(maxMonths / 12).toFixed(1)} 年，过长`);
  assert.ok(totalFails >= 0);
});

test('三种代表性组合在固定种子下都能通关，且高灵根更快', () => {
  const combos = [
    ['heaven', 'genius'],
    ['triple', 'plain'],
    ['mixed', 'plain'],
  ];
  const months = combos.map(([root, talent]) => {
    const { c } = playFullGame(root, talent, 20261109);
    assert.equal(c.realmId, MAX_REALM_ID);
    assert.equal(isDead(c), false);
    return c.months;
  });
  assert.ok(months[0] < months[1], '天灵根应快于三灵根');
  assert.ok(months[1] < months[2], '三灵根应快于五行杂灵根');
});

test('软保底：连续失败 5 次后，下一次必定成功', () => {
  const c = createCharacter({ name: '霉运', rootId: 'mixed', talentId: 'plain' });
  c.realmId = 12; // 筑基后期 → 金丹初期，基础成功率最低（40%）
  c.stones = 100000;

  const badRng = createRng(1);
  badRng.chance = () => false;
  badRng.float = () => 0.99;

  for (let i = 0; i < PITY_GUARANTEE; i += 1) {
    c.exp = getRealm(12).expToNext;
    const result = attemptBreakthrough(c, badRng);
    assert.equal(result.success, false, `第 ${i + 1} 次应失败`);
    assert.equal(c.pity[12], i + 1, '保底计数应随失败累加');
  }
  // 第 6 次：概率被拉到 100%
  c.exp = getRealm(12).expToNext;
  assert.equal(breakthroughChance(c), 1, '连续失败 5 次后成功率应为 100%');
  const final = attemptBreakthrough(c, badRng);
  assert.equal(final.success, true, '保底触发后必须成功');
  assert.equal(c.realmId, MAX_REALM_ID);
  assert.equal(c.pity[12], undefined, '成功的保底计数应清空');
});

test('软保底计数在成功后清零', () => {
  const c = createCharacter({ name: '保底', rootId: 'triple', talentId: 'plain' });
  c.realmId = 9; // 炼气九层 → 筑基初期，基础成功率 45%
  c.exp = getRealm(9).expToNext;
  c.stones = 1000;

  const failRng = createRng(7);
  failRng.chance = () => false;
  attemptBreakthrough(c, failRng);
  assert.equal(c.pity[9], 1, '失败后应记录保底计数');

  c.exp = getRealm(9).expToNext;
  const okRng = createRng(8);
  okRng.chance = () => true;
  attemptBreakthrough(c, okRng);
  assert.equal(c.realmId, 10);
  assert.equal(c.pity[9], undefined, '成功后保底计数应清零');
});

test('理论总修炼月数与数值表一致（防止改坏数值）', () => {
  const months = totalMonthsToPeak();
  assert.ok(months > 200 && months < 320, `总月数 ${months} 超出预期区间`);
});
