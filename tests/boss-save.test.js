/**
 * Boss 存档回归（ChatGPT v1.0 RC1 第二阶段）
 *
 * 覆盖：开战 / 预警 / 余雷 / 反击加成 / 丹药次数 / 二阶段 六种状态的存读一致，
 * 以及非法 Boss 存档必须拒绝（不能因为支持 Boss 就放行任意 enemyId）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, maxHp } from '../src/core/gameState.js';
import { COMBAT_ACTIONS, startCombat, resolveTurn } from '../src/core/combat.js';
import { BOSS } from '../src/data/boss.js';
import { createRng } from '../src/core/rng.js';
import * as Save from '../src/core/saveManager.js';

function bossReady() {
  const c = createCharacter({ name: '回归', rootId: 'heaven', talentId: 'genius' });
  c.realmId = 13;
  c.hp = maxHp(c);
  c.stones = 120;
  c.inventory = { healingPill: 3 };
  return c;
}

function roundTrip(character) {
  const payload = Save.serialize(character);
  const result = Save.deserialize(payload);
  assert.equal(result.ok, true, result.error || '');
  return result.character;
}

test('Boss 开战后存档：能正确读回 Boss 状态', () => {
  const c = bossReady();
  assert.equal(startCombat(c, BOSS.id, createRng(1)).ok, true);
  const loaded = roundTrip(c);
  assert.equal(loaded.combat.enemyId, BOSS.id);
  assert.equal(loaded.combat.isBoss, true);
  assert.equal(loaded.combat.phase, 1);
  assert.equal(loaded.combat.enemyHp, BOSS.hp);
  assert.equal(loaded.combat.enemyMaxHp, BOSS.hp);
});

test('雷云预警中存档：telegraph 保持', () => {
  const c = bossReady();
  startCombat(c, BOSS.id, createRng(2));
  c.combat.round = BOSS.telegraphEvery;
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(3));
  assert.equal(c.combat.telegraph, true);
  const loaded = roundTrip(c);
  assert.equal(loaded.combat.telegraph, true);
  assert.equal(loaded.combat.thunderStats.warned, 1);
});

test('余雷未结算时存档：residualThunder 保持', () => {
  const c = bossReady();
  startCombat(c, BOSS.id, createRng(4));
  c.combat.round = BOSS.telegraphEvery;
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(5)); // 预警
  c.hp = maxHp(c);
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(6)); // 漏防 → 产生余雷
  assert.ok(c.combat.residualThunder > 0);
  const loaded = roundTrip(c);
  assert.equal(loaded.combat.residualThunder, c.combat.residualThunder);
});

test('反击加成状态存档：counterBonus 保持', () => {
  const c = bossReady();
  startCombat(c, BOSS.id, createRng(7));
  c.combat.round = BOSS.telegraphEvery;
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(8)); // 预警
  c.hp = maxHp(c);
  resolveTurn(c, COMBAT_ACTIONS.DEFEND, createRng(9)); // 成功防御 → 反击加成
  assert.equal(c.combat.counterBonus, true);
  const loaded = roundTrip(c);
  assert.equal(loaded.combat.counterBonus, true);
});

test('丹药使用次数存档：pillsUsed 保持', () => {
  const c = bossReady();
  startCombat(c, BOSS.id, createRng(10));
  resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(11));
  assert.equal(c.combat.pillsUsed, 1);
  const loaded = roundTrip(c);
  assert.equal(loaded.combat.pillsUsed, 1);
  assert.equal(loaded.inventory.healingPill, 2);
});

test('二阶段存档：phase=2 且攻击倍率不会在读档后重复叠加', () => {
  const c = bossReady();
  startCombat(c, BOSS.id, createRng(12));
  c.combat.enemyHp = Math.round(BOSS.hp * 0.45);
  resolveTurn(c, COMBAT_ACTIONS.ATTACK, createRng(13));
  assert.equal(c.combat.phase, 2);
  const atk = c.combat.enemyAtk;
  const loaded = roundTrip(c);
  assert.equal(loaded.combat.phase, 2);
  assert.equal(loaded.combat.enemyAtk, atk, '读档不应再次放大攻击');

  startCombat(loaded, BOSS.id, createRng(14)); // 已通关/进行中应被拒绝
  assert.equal(loaded.combat.enemyAtk, atk);
});

test('非法 Boss 存档必须被拒绝（不能因为支持 Boss 就放行任意敌人）', () => {
  const base = () => {
    const c = bossReady();
    startCombat(c, BOSS.id, createRng(15));
    return Save.serialize(c);
  };

  const unknownEnemy = base();
  unknownEnemy.character.combat.enemyId = 'not-a-real-boss';
  assert.equal(Save.validate(unknownEnemy).ok, false);

  const badPhase = base();
  badPhase.character.combat.phase = 3;
  assert.equal(Save.validate(badPhase).ok, false);

  const negResidual = base();
  negResidual.character.combat.residualThunder = -5;
  assert.equal(Save.validate(negResidual).ok, false);

  const badTelegraph = base();
  badTelegraph.character.combat.telegraph = 'yes';
  assert.equal(Save.validate(badTelegraph).ok, false);

  const badStats = base();
  badStats.character.combat.thunderStats = 'oops';
  assert.equal(Save.validate(badStats).ok, false);
});

test('Boss 身份与标记必须一致：Boss 不能伪装成普通妖兽，普通妖兽不能标成 Boss', () => {
  const asNormal = bossReady();
  startCombat(asNormal, BOSS.id, createRng(21));
  const s1 = Save.serialize(asNormal);
  s1.character.combat.isBoss = false;
  assert.equal(Save.validate(s1).ok, false, 'Boss ID 标成普通应被拒绝');

  const fakeBoss = bossReady();
  startCombat(fakeBoss, 'iron-wolf', createRng(22));
  const s2 = Save.serialize(fakeBoss);
  s2.character.combat.isBoss = true;
  assert.equal(Save.validate(s2).ok, false, '普通妖兽标成 Boss 应被拒绝');
});

test('雷霆统计与反击标记逐项校验', () => {
  const make = () => {
    const c = bossReady();
    startCombat(c, BOSS.id, createRng(23));
    return Save.serialize(c);
  };
  const badWarned = make();
  badWarned.character.combat.thunderStats.warned = -1;
  assert.equal(Save.validate(badWarned).ok, false);

  const badDefended = make();
  badDefended.character.combat.thunderStats.defended = 1.5;
  assert.equal(Save.validate(badDefended).ok, false);

  const badCounter = make();
  badCounter.character.combat.counterBonus = 'yes';
  assert.equal(Save.validate(badCounter).ok, false);
});
