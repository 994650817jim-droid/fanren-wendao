/**
 * 最终 Boss（雷霆麒麟 · 镇坛古灵）测试
 * 对应 ChatGPT v0.12：两阶段只触发一次、雷霆可预警可防御、通关奖励只结算一次、旧存档可加载
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, maxHp } from '../src/core/gameState.js';
import { COMBAT_ACTIONS, shouldTeachThunderDefense, startCombat, resolveTurn } from '../src/core/combat.js';
import { BOSS } from '../src/data/boss.js';
import { createRng } from '../src/core/rng.js';
import * as Save from '../src/core/saveManager.js';

function bossReadyCharacter() {
  const c = createCharacter({ name: '金丹道友', rootId: 'heaven', talentId: 'genius' });
  c.realmId = 13;
  c.hp = maxHp(c);
  c.stones = 500;
  return c;
}

test('境界不足时无法挑战最终 Boss', () => {
  const c = createCharacter({ name: '凡人', rootId: 'triple', talentId: 'plain' });
  const result = startCombat(c, BOSS.id, createRng(1));
  assert.equal(result.ok, false);
  assert.match(result.reason, /境界不足/);
  assert.equal(c.combat, null);
});

test('金丹期可开战：Boss 满血、一阶段、雷霆未蓄力', () => {
  const c = bossReadyCharacter();
  const result = startCombat(c, BOSS.id, createRng(2));
  assert.equal(result.ok, true);
  assert.equal(c.combat.isBoss, true);
  assert.equal(c.combat.phase, 1);
  assert.equal(c.combat.telegraph, false);
  assert.equal(c.combat.enemyHp, BOSS.hp);
  assert.equal(c.combat.enemyMaxHp, BOSS.hp);
});

test('雷霆蓄力有预警且不造成伤害，下一回合落下雷霆', () => {
  const c = bossReadyCharacter();
  startCombat(c, BOSS.id, createRng(3));
  // 第 1、2 回合普通攻击
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(4));
  const hpBeforeCharge = c.hp;
  c.combat.round = BOSS.telegraphEvery; // 让下一次成为蓄力回合
  const charge = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(5));
  assert.equal(c.combat.telegraph, true, '蓄力回合应设置预警');
  assert.equal(c.hp, hpBeforeCharge, '蓄力回合不应造成伤害');
  assert.ok(charge.events.some((line) => line.includes('雷霆将落')));

  const hpBeforeThunder = c.hp;
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(6));
  assert.equal(c.combat.telegraph, false, '雷霆落下后清除预警');
  assert.ok(c.hp < hpBeforeThunder, '雷霆应造成伤害');
});

test('防御能显著降低雷霆伤害', () => {
  const normal = bossReadyCharacter();
  startCombat(normal, BOSS.id, createRng(7));
  normal.combat.round = BOSS.telegraphEvery;
  resolveTurn(normal, COMBAT_ACTIONS.ATTACK, createRng(8)); // 蓄力
  const hpStart = normal.hp = maxHp(normal);
  resolveTurn(normal, COMBAT_ACTIONS.ATTACK, createRng(9));
  const normalLoss = hpStart - normal.hp;

  const guarding = bossReadyCharacter();
  startCombat(guarding, BOSS.id, createRng(7));
  guarding.combat.round = BOSS.telegraphEvery;
  resolveTurn(guarding, COMBAT_ACTIONS.ATTACK, createRng(8)); // 蓄力
  guarding.hp = maxHp(guarding);
  resolveTurn(guarding, COMBAT_ACTIONS.DEFEND, createRng(9));
  const guardedLoss = maxHp(guarding) - guarding.hp;

  assert.ok(guardedLoss < normalLoss, `防御后受伤 ${guardedLoss} 应小于硬抗 ${normalLoss}`);
  assert.ok(guardedLoss <= Math.round(normalLoss * 0.5), '防御至少减伤一半');
});

test('二阶段只触发一次，且只放大一次攻击', () => {
  const c = bossReadyCharacter();
  startCombat(c, BOSS.id, createRng(11));
  const atkStage1 = c.combat.enemyAtk;
  c.combat.enemyHp = Math.round(BOSS.hp * 0.45);
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(12));
  assert.equal(c.combat.phase, 2, '跌破 50% 应进入二阶段');
  const atkStage2 = c.combat.enemyAtk;
  assert.ok(atkStage2 > atkStage1, '二阶段攻击应提高');

  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(13));
  assert.equal(c.combat.phase, 2);
  assert.equal(c.combat.enemyAtk, atkStage2, '二阶段不得重复放大攻击');
});

test('击杀 Boss 写入通关标记，且不能重复领取', () => {
  const c = bossReadyCharacter();
  startCombat(c, BOSS.id, createRng(14));
  c.combat.enemyHp = 1;
  const before = c.stones;
  const result = resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(15));
  assert.equal(result.finished, true);
  assert.equal(result.result, 'victory');
  assert.equal(c.victory, true);
  assert.equal(c.combat, null);
  assert.equal(c.stones, before + BOSS.rewardStones);

  const again = startCombat(c, BOSS.id, createRng(16));
  assert.equal(again.ok, false);
  assert.match(again.reason, /已通过最终试炼/);
  assert.equal(c.stones, before + BOSS.rewardStones, '不得二次发奖');
});

test('v4 旧存档迁移到 v5：victory 补为 false，v5 存档保留通关标记', () => {
  const legacy = {
    version: 4,
    savedAt: new Date().toISOString(),
    character: {
      name: '旧档道友', rootId: 'dual', talentId: 'plain',
      realmId: 13, exp: 0, hp: 100, stones: 10, months: 300,
      pity: {}, pendingEvent: null, combat: null,
      log: [],
    },
  };
  const migrated = Save.migrate(legacy);
  assert.equal(migrated.version, 7);
  assert.equal(migrated.character.victory, false);
  const loaded = Save.deserialize(legacy);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.character.victory, false);

  const c = bossReadyCharacter();
  c.victory = true;
  const round = Save.parseSaveText(JSON.stringify(Save.serialize(c)));
  assert.equal(round.ok, true);
  assert.equal(round.character.victory, true);
});

test('victory 字段类型错误时拒绝导入', () => {
  const c = bossReadyCharacter();
  const save = Save.serialize(c);
  save.character.victory = 'yes';
  const result = Save.validate(save);
  assert.equal(result.ok, false);
  assert.match(result.error, /victory/);
});



test('首次战败教学提示：漏防且从未防御才提示，成功防御过则不提示', () => {
  const base = { isBoss: true, thunderStats: { warned: 2, defended: 0, missed: 1, recovered: 0 } };
  assert.equal(shouldTeachThunderDefense(base), true, '漏防且从未防御 → 应提示');

  const defended = { isBoss: true, thunderStats: { warned: 2, defended: 1, missed: 1, recovered: 0 } };
  assert.equal(shouldTeachThunderDefense(defended), false, '成功防御过 → 不应提示');

  const neverWarned = { isBoss: true, thunderStats: { warned: 0, defended: 0, missed: 0, recovered: 0 } };
  assert.equal(shouldTeachThunderDefense(neverWarned), false, '没遇到过雷霆 → 不应提示');

  const notBoss = { isBoss: false, thunderStats: { warned: 3, defended: 0, missed: 3, recovered: 0 } };
  assert.equal(shouldTeachThunderDefense(notBoss), false, '普通战斗 → 不应提示');

  assert.equal(shouldTeachThunderDefense(null), false, '空状态 → 不应提示');
});
