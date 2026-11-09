/**
 * 剧情状态 / 连续奇遇 / 一次性事件测试（ChatGPT v0.16）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../src/core/gameState.js';
import { EVENTS, getEventById, pickEvent } from '../src/data/events.js';
import { applyChoice, startExplore } from '../src/core/explore.js';
import { createRng } from '../src/core/rng.js';
import * as Save from '../src/core/saveManager.js';

test('事件库扩展到 30 条，且包含四组类型', () => {
  assert.equal(EVENTS.length, 30);
  const low = EVENTS.filter((e) => e.minRealm <= 5).length;
  const mid = EVENTS.filter((e) => e.minRealm >= 10 && e.minRealm < 13).length;
  const high = EVENTS.filter((e) => e.minRealm >= 13).length;
  const chained = EVENTS.filter((e) => e.id.startsWith('chain-') || (Array.isArray(e.requiresFlags) && e.requiresFlags.length > 0)).length;
  assert.ok(low >= 6, `炼气期事件不足：${low}`);
  assert.ok(mid >= 6, `筑基期事件不足：${mid}`);
  assert.ok(high >= 4, `金丹期事件不足：${high}`);
  assert.ok(chained >= 4, `连续型事件不足：${chained}`);
});

test('一次性事件完成后不会再被抽到', () => {
  const c = createCharacter({ name: '甲', rootId: 'triple', talentId: 'plain' });
  c.realmId = 13;
  c.story.completedEvents = EVENTS.filter((e) => e.repeatable === false).map((e) => e.id);
  for (let seed = 1; seed <= 200; seed += 1) {
    const picked = pickEvent(c, createRng(seed));
    if (!picked) continue;
    assert.notEqual(picked.repeatable, false, `已完成的 ${picked.id} 不应再出现`);
  }
});

test('连续型事件需要前置 flag 才能出现', () => {
  const c = createCharacter({ name: '乙', rootId: 'triple', talentId: 'plain' });
  c.realmId = 13;
  const chainedIds = EVENTS.filter((e) => Array.isArray(e.requiresFlags) && e.requiresFlags.length).map((e) => e.id);
  for (let seed = 1; seed <= 300; seed += 1) {
    const picked = pickEvent(c, createRng(seed));
    if (picked) assert.equal(chainedIds.includes(picked.id), false, `无 flag 时不该出现 ${picked.id}`);
  }
  // 补上 flag 后应有机会出现
  c.story.flags = { steleRead: true, caveFound: true };
  let appeared = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const picked = pickEvent(c, createRng(seed));
    if (picked && chainedIds.includes(picked.id)) appeared += 1;
  }
  assert.ok(appeared > 0, '满足前置条件后连续型事件应能出现');
});

test('历练记录 seenEvents，选择后记录 completedEvents 并写入 flags', () => {
  const c = createCharacter({ name: '丙', rootId: 'triple', talentId: 'plain' });
  c.realmId = 13;
  c.story.flags = { steleRead: true, caveFound: true };
  // 找一条会设置 flag 的事件
  const chain = getEventById('chain-lastword');
  const choice = chain.choices[0];
  c.pendingEvent = { eventId: chain.id, atMonth: c.months };
  c.story.seenEvents = [chain.id];

  const result = applyChoice(c, chain.id, choice.id, createRng(5));
  assert.equal(result.ok, true);
  assert.ok(c.story.completedEvents.includes(chain.id), '完成的事件应进 completedEvents');
  assert.ok(c.story.seenEvents.includes(chain.id), 'seenEvents 应保留');
  assert.equal(c.story.flags.knowsThunderPattern, true);
  assert.equal(c.pendingEvent, null);
});

test('特殊奇遇可以产出疗伤丹（真实库存）', () => {
  const c = createCharacter({ name: '丁', rootId: 'triple', talentId: 'plain' });
  c.realmId = 13;
  const event = getEventById('golden-furnace');
  c.pendingEvent = { eventId: event.id, atMonth: c.months };
  const before = c.inventory.healingPill;
  const result = applyChoice(c, event.id, 'refine', createRng(3));
  assert.equal(result.ok, true);
  assert.ok(c.inventory.healingPill >= before, '丹药不应减少');
});

test('v6 存档迁移到 v7：待处理奇遇进 seenEvents，不进 completedEvents', () => {
  const legacy = {
    version: 6,
    savedAt: new Date().toISOString(),
    character: {
      name: '旧档', rootId: 'dual', talentId: 'plain',
      realmId: 6, exp: 0, hp: 120, stones: 40, months: 200,
      pity: {}, pendingEvent: { eventId: 'herb-gather', atMonth: 200 }, combat: null, victory: false,
      inventory: { healingPill: 2 }, log: [],
    },
  };
  const migrated = Save.migrate(legacy);
  assert.equal(migrated.version, 7);
  assert.deepEqual(migrated.character.story.seenEvents, ['herb-gather']);
  assert.deepEqual(migrated.character.story.completedEvents, []);
  assert.equal(migrated.character.inventory.healingPill, 2);

  const loaded = Save.deserialize(legacy);
  assert.equal(loaded.ok, true);
  assert.ok(loaded.character.story.seenEvents.includes('herb-gather'));
  assert.equal(loaded.character.story.completedEvents.length, 0);
});

test('剧情状态可以随存档往返', () => {
  const c = createCharacter({ name: '戊', rootId: 'triple', talentId: 'plain' });
  c.story.flags = { steleRead: true, caveFound: true };
  c.story.seenEvents = ['chain-stele', 'chain-cave'];
  c.story.completedEvents = ['chain-stele'];
  const round = Save.parseSaveText(JSON.stringify(Save.serialize(c)));
  assert.equal(round.ok, true);
  assert.equal(round.character.story.flags.steleRead, true);
  assert.deepEqual(round.character.story.completedEvents, ['chain-stele']);
});

