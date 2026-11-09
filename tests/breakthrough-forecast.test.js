/**
 * 突破预测（界面显示）测试：确保显示概率 = 实际判定概率，
 * 并把保底进度与失败代价算对。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../src/core/gameState.js';
import { breakthroughChance, breakthroughForecast, PITY_GUARANTEE } from '../src/core/breakthrough.js';
import { getRealm } from '../src/data/realms.js';

function hero(realmId, pity = 0, talentId = 'plain') {
  const c = createCharacter({ name: 'x', rootId: 'triple', talentId });
  c.realmId = realmId;
  c.stones = 999;
  if (pity) c.pity = { [realmId]: pity };
  return c;
}

test('界面显示的概率与实际判定概率完全一致', () => {
  for (const realmId of [0, 3, 6, 10, 12]) {
    const c = hero(realmId);
    const f = breakthroughForecast(c);
    assert.equal(f.chance, breakthroughChance(c));
    assert.equal(f.shownPct, Math.round(breakthroughChance(c) * 100));
  }
});

test('保底进度：失败次数越多，下次概率越高，到 5 次必成', () => {
  const realmId = 6;
  const base = breakthroughForecast(hero(realmId)).chance;
  for (let pity = 1; pity < PITY_GUARANTEE; pity += 1) {
    const f = breakthroughForecast(hero(realmId, pity));
    assert.equal(f.pityCount, pity);
    assert.ok(f.nextChancePct >= f.shownPct, '下次概率不应低于当前');
    assert.equal(f.attemptsToGuarantee, PITY_GUARANTEE - pity);
    assert.ok(f.chance > base);
  }
  const guaranteed = breakthroughForecast(hero(realmId, PITY_GUARANTEE));
  assert.equal(guaranteed.chance, 1);
  assert.equal(guaranteed.shownPct, 100);
});

test('失败代价与界面文案口径一致（25% 修为 / 20% 气血 / 6 个月）', () => {
  const f = breakthroughForecast(hero(6));
  assert.equal(f.lossExpRatio, 0.25);
  assert.equal(f.lossHpRatio, 0.2);
  assert.equal(f.monthsLost, 6);
  assert.equal(getRealm(6).name, '炼气六层');
});
