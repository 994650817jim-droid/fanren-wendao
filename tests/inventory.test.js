/**
 * 背包 / 洞府丹房 / 存档 v6 测试（ChatGPT v0.15 指令）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../src/core/gameState.js';
import { ACTIONS, resolveAction } from '../src/core/actions.js';
import { COMBAT_ACTIONS, startCombat, resolveTurn } from '../src/core/combat.js';
import { PILL_MAX_PER_BATTLE, PILL_PRICE } from '../src/core/inventory.js';
import { createRng } from '../src/core/rng.js';
import * as Save from '../src/core/saveManager.js';

test('新角色背包为空，灵石不会被换算成丹药', () => {
  const c = createCharacter({ name: '甲', rootId: 'triple', talentId: 'plain' });
  assert.equal(c.inventory.healingPill, 0);
  c.stones = 999;
  assert.equal(c.inventory.healingPill, 0);
});

test('洞府丹房购买走 resolveAction 且原子结算', () => {
  const c = createCharacter({ name: '乙', rootId: 'triple', talentId: 'plain' });
  c.stones = 20;
  const ok = resolveAction(c, ACTIONS.BUY_PILL, createRng(1), { count: 2 });
  assert.equal(ok.ok, true);
  assert.equal(ok.character.stones, 20 - PILL_PRICE * 2);
  assert.equal(ok.character.inventory.healingPill, 2);

  const rich = createCharacter({ name: '丙', rootId: 'triple', talentId: 'plain' });
  rich.stones = 5;
  const fail = resolveAction(rich, ACTIONS.BUY_PILL, createRng(2), { count: 1 });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /灵石不足/);
  assert.equal(fail.character.stones, 5, '失败不得扣钱');
  assert.equal(fail.character.inventory.healingPill, 0, '失败不得加货');
});

test('战斗中服丹消耗真实库存，且单场最多 2 枚', () => {
  const c = createCharacter({ name: '丁', rootId: 'triple', talentId: 'plain' });
  c.realmId = 4;
  c.hp = 30;
  c.stones = 100;
  c.inventory = { healingPill: 3 };
  startCombat(c, 'iron-wolf', createRng(3));
  for (let i = 0; i < PILL_MAX_PER_BATTLE; i += 1) {
    const r = resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(10 + i));
    assert.equal(r.ok, true, `第 ${i + 1} 枚应可用`);
  }
  const third = resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(20));
  assert.equal(third.ok, false);
  assert.match(third.reason, /已服/);
  assert.equal(c.inventory.healingPill, 1, '被拒绝的服药不消耗库存');
});

test('库存为零时服丹被拒绝，且提示不足', () => {
  const c = createCharacter({ name: '戊', rootId: 'triple', talentId: 'plain' });
  c.realmId = 4;
  startCombat(c, 'iron-wolf', createRng(4));
  const r = resolveTurn(c, COMBAT_ACTIONS.ITEM, createRng(5));
  assert.equal(r.ok, false);
  assert.match(r.reason, /不足/);
});

test('v5 存档迁移到 v6 补 inventory，且保持灵石/战斗/通关标记', () => {
  const legacy = {
    version: 5,
    savedAt: new Date().toISOString(),
    character: {
      name: '旧档', rootId: 'dual', talentId: 'plain',
      realmId: 13, exp: 0, hp: 500, stones: 77, months: 400,
      pity: {}, pendingEvent: null, combat: null, victory: true, log: [],
    },
  };
  const migrated = Save.migrate(legacy);
  assert.equal(migrated.version, 7);
  assert.equal(migrated.character.inventory.healingPill, 0);
  assert.equal(migrated.character.stones, 77);
  assert.equal(migrated.character.victory, true);
  assert.equal(migrated.character.combat, null);

  const loaded = Save.deserialize(legacy);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.character.inventory.healingPill, 0);
  assert.equal(loaded.character.stones, 77);
});

test('背包序列化后可完整读回', () => {
  const c = createCharacter({ name: '己', rootId: 'triple', talentId: 'plain' });
  c.inventory = { healingPill: 4 };
  const round = Save.parseSaveText(JSON.stringify(Save.serialize(c)));
  assert.equal(round.ok, true);
  assert.equal(round.character.inventory.healingPill, 4);
});

