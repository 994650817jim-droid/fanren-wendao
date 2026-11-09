/**
 * 最小回合制战斗测试（权威状态版）。
 * 覆盖 P0-3：前端不能回传战斗对象，同一场战斗不能二次发奖。
 * 覆盖 P0-4：战斗状态随存档持久化，刷新可恢复。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, maxHp, sanitize } from '../src/core/gameState.js';
import { COMBAT_ACTIONS, MAX_ROUNDS, PILL_COST_STONES, hasActiveCombat, resolveTurn, startCombat } from '../src/core/combat.js';
import { ENEMIES, getEnemy, pickEnemy } from '../src/data/enemies.js';
import { createRng } from '../src/core/rng.js';
import { getRealm } from '../src/data/realms.js';
import * as Save from '../src/core/saveManager.js';

function hero(realmId = 2) {
  const c = createCharacter({ name: '斗法', rootId: 'triple', talentId: 'plain' });
  c.realmId = realmId;
  c.hp = maxHp(c);
  c.stones = 50;
  return c;
}

test('敌人数据完整，按境界权重抽取', () => {
  for (const enemy of ENEMIES) {
    assert.ok(enemy.id && enemy.name && enemy.desc);
    assert.ok(enemy.hp > 0 && enemy.atk > 0 && enemy.def >= 0);
  }
  const low = hero(0);
  for (let seed = 1; seed <= 50; seed += 1) {
    const enemy = pickEnemy(low, createRng(seed));
    assert.ok(enemy.minRealm <= 0);
  }
});

test('开战把战斗写入角色权威状态（P0-3）', () => {
  const c = hero();
  const before = getEnemy('iron-wolf').hp;
  const r = startCombat(c, 'iron-wolf', createRng(3));
  assert.equal(r.ok, true);
  assert.ok(c.combat, '战斗必须写进 character.combat');
  assert.equal(c.combat.status, 'active');
  assert.ok(c.combat.enemyHp > 0);
  assert.equal(c.combat.enemyId, 'iron-wolf');
  assert.equal(getEnemy('iron-wolf').hp, before, '不得修改敌人配置表');
  const again = startCombat(c, 'iron-wolf', createRng(3));
  assert.equal(again.ok, false, '已有战斗时不得再开战');
});

test('普通攻击：伤害敌人并遭受反击', () => {
  const c = hero(2);
  startCombat(c, 'iron-wolf', createRng(11));
  const enemyHpBefore = c.combat.enemyHp;
  const hpBefore = c.hp;
  const r = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(11));
  assert.equal(r.ok, true);
  if (!r.finished) {
    assert.ok(c.combat.enemyHp < enemyHpBefore);
    assert.ok(c.hp < hpBefore);
    assert.ok(c.hp >= 1);
  }
});

test('技能有冷却，冷却期内被拒绝且不消耗状态', () => {
  const c = hero(3);
  startCombat(c, 'red-cat', createRng(5));
  const rng = createRng(5);
  const first = resolveTurn(c, COMBAT_ACTIONS.SKILL, rng);
  assert.equal(first.ok, true);
  if (!first.finished) {
    const snapshot = JSON.stringify(c.combat);
    const second = resolveTurn(c, COMBAT_ACTIONS.SKILL, rng);
    assert.equal(second.ok, false);
    assert.match(second.reason, /冷却/);
    assert.equal(JSON.stringify(c.combat), snapshot, '被拒绝时战斗状态不得改变');
  }
});

test('丹药库存为零时无法服丹', () => {
  const c = hero(1);
  c.inventory = { healingPill: 0 };
  startCombat(c, 'iron-wolf', createRng(7));
  const r = resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(7));
  assert.equal(r.ok, false);
  assert.match(r.reason, /不足/);
  assert.equal(c.inventory.healingPill, 0);
});

test('服丹消耗真实库存并回血，单场最多 2 枚', () => {
  const c = hero(2);
  c.hp = 20;
  c.inventory = { healingPill: 5 };
  startCombat(c, 'iron-wolf', createRng(9));
  const first = resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(9));
  assert.equal(first.ok, true);
  assert.equal(c.inventory.healingPill, 4);
  assert.ok(c.hp <= maxHp(c));

  resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(10));
  const third = resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(11));
  assert.equal(third.ok, false);
  assert.match(third.reason, /此战已服/);
  assert.equal(c.inventory.healingPill, 3, '被拒绝的服药不得消耗库存');
});

test('战斗一定在有限回合内结束，数值不越界', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const c = hero(4);
    startCombat(c, 'red-cat', createRng(seed));
    let guard = 0;
    let result = null;
    while (hasActiveCombat(c) && guard < 100) {
      const r = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(seed + guard));
      guard += 1;
      if (r.finished) result = r.result;
      assert.ok(c.hp >= 1);
      assert.ok(c.hp <= maxHp(c));
    }
    assert.ok(result, `种子 ${seed} 战斗没有结束`);
    assert.ok(['victory', 'defeat', 'flee'].includes(result));
    assert.ok(guard <= MAX_ROUNDS + 1);
    assert.equal(c.combat, null, '战斗结束后必须清空战斗状态');
  }
});

test('同一场战斗不能二次结算发奖（P0-3）', () => {
  const c = hero(0);
  startCombat(c, 'iron-wolf', createRng(6));
  // 把敌人打残后击杀
  c.combat.enemyHp = 1;
  const r = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(6));
  assert.equal(r.result, 'victory');
  const stonesAfter = c.stones;
  const expAfter = c.exp;
  assert.equal(c.combat, null);

  // 再次提交回合：没有进行中的战斗，不得再发奖
  const again = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(6));
  assert.equal(again.ok, false);
  assert.match(again.reason, /没有进行中/);
  assert.equal(c.stones, stonesAfter, '不得重复发灵石');
  assert.equal(c.exp, expAfter, '不得重复发修为');
});

test('战斗中途刷新可恢复（P0-4）', () => {
  const c = hero(3);
  startCombat(c, 'red-cat', createRng(21));
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(21));
  const hpSnapshot = c.combat.enemyHp;

  const payload = Save.serialize(c);
  assert.ok(payload.character.combat, '存档必须包含战斗状态');
  assert.equal(payload.version, Save.SAVE_VERSION);

  const restored = Save.deserialize(payload);
  assert.equal(restored.ok, true);
  assert.ok(restored.character.combat, '读档后战斗仍然存在');
  assert.equal(restored.character.combat.status, 'active');
  assert.equal(restored.character.combat.enemyHp, hpSnapshot);
  assert.equal(hasActiveCombat(restored.character), true);
});

test('战败：气血保底 1、损失两成灵石、战斗清空', () => {
  const c = hero(0);
  c.stones = 100;
  c.hp = 1;
  startCombat(c, 'iron-wolf', createRng(4));
  let guard = 0;
  let result = null;
  while (hasActiveCombat(c) && guard < 50) {
    const r = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(4 + guard));
    guard += 1;
    if (r.finished) result = r.result;
  }
  assert.equal(result, 'defeat');
  assert.equal(c.hp, 1);
  assert.ok(c.stones >= 0 && c.stones <= 100);
  assert.equal(c.combat, null);
});

test('sanitize 会清掉非法战斗状态', () => {
  const c = hero(1);
  c.combat = { status: 'active', enemyId: 'x', enemyHp: -5, enemyMaxHp: 10 };
  sanitize(c);
  assert.equal(c.combat, null, '负数气血的战斗应被清空');
  c.combat = { status: 'settled' };
  sanitize(c);
  assert.equal(c.combat, null);
});


