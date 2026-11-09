/**
 * 阶段二：历练与奇遇的数据完整性 + 结算测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { EVENTS, getEventById, pickEvent } from '../src/data/events.js';
import { createCharacter, isDead, maxHp } from '../src/core/gameState.js';
import { applyChoice, startExplore, EXPLORE_MONTHS, EXPLORE_BASE_STONES } from '../src/core/explore.js';
import { getRealm } from '../src/data/realms.js';
import { createRng } from '../src/core/rng.js';

const ALLOWED_EFFECTS = new Set(['exp', 'stones', 'hp', 'months', 'item']);

test('事件库结构完整：id 唯一、字段齐全、权重为正', () => {
  const ids = new Set();
  for (const event of EVENTS) {
    assert.equal(typeof event.id, 'string');
    assert.ok(event.id.length > 0);
    assert.equal(ids.has(event.id), false, `事件 id 重复：${event.id}`);
    ids.add(event.id);

    assert.ok(event.title && event.title.length > 0, `${event.id} 缺标题`);
    assert.ok(event.desc && event.desc.length > 10, `${event.id} 描述过短`);
    assert.equal(Number.isInteger(event.minRealm), true, `${event.id} minRealm 必须是整数`);
    assert.ok(event.weight > 0, `${event.id} 权重必须为正`);
    assert.ok(Array.isArray(event.choices) && event.choices.length >= 2, `${event.id} 至少要有 2 个选择`);

    const choiceIds = new Set();
    for (const choice of event.choices) {
      assert.ok(choice.id && !choiceIds.has(choice.id), `${event.id} 的选择 id 唯一`);
      choiceIds.add(choice.id);
      assert.ok(choice.text && choice.text.length > 0, `${event.id}/${choice.id} 缺选项文案`);
      assert.ok(Array.isArray(choice.outcomes) && choice.outcomes.length >= 1, `${event.id}/${choice.id} 至少一个结果`);
      for (const outcome of choice.outcomes) {
        assert.ok(outcome.weight > 0, `${event.id}/${choice.id} 结果权重必须为正`);
        assert.ok(outcome.text && outcome.text.length > 0);
        for (const effect of outcome.effects || []) {
          assert.ok(ALLOWED_EFFECTS.has(effect.type), `${event.id} 出现未知效果类型 ${effect.type}`);
          if (effect.type === 'exp' || effect.type === 'hp') {
            assert.equal(typeof effect.ratio, 'number');
          } else if (effect.type === 'item') {
            assert.equal(typeof effect.id, 'string');
            assert.ok(Number.isInteger(effect.count) && effect.count > 0, `${effect.id} 数量必须是正整数`);
          } else {
            assert.equal(typeof effect.value, 'number');
          }
        }
      }
    }
  }
  assert.ok(EVENTS.length >= 10, `事件数量 ${EVENTS.length} 少于 10`);
});

test('凡人也能抽到奇遇（至少有一条 minRealm=0 的事件）', () => {
  const c = createCharacter({ name: '凡人', rootId: 'mixed', talentId: 'plain' });
  assert.equal(c.realmId, 0);
  const event = pickEvent(c, createRng(1));
  assert.ok(event, '凡人阶段应该有可触发的事件');
  assert.equal(event.minRealm, 0);
});

test('pickEvent 不会返回超出当前境界的事件', () => {
  const c = createCharacter({ name: '炼气', rootId: 'triple', talentId: 'plain' });
  c.realmId = 2;
  for (let seed = 1; seed <= 200; seed += 1) {
    const event = pickEvent(c, createRng(seed));
    assert.ok(event);
    assert.ok(event.minRealm <= 2, `境界 2 抽到了 minRealm=${event.minRealm} 的事件`);
  }
});

test('历练：消耗 3 个月、获得保底灵石、返回奇遇', () => {
  const c = createCharacter({ name: '历练', rootId: 'triple', talentId: 'plain' });
  const monthsBefore = c.months;
  const result = startExplore(c, createRng(7));
  assert.equal(result.ok, true);
  assert.equal(c.months, monthsBefore + EXPLORE_MONTHS);
  assert.ok(result.stones >= EXPLORE_BASE_STONES, '历练必须给保底灵石');
  assert.equal(c.stones, result.stones);
  assert.ok(result.event, '应返回一条奇遇');
});

test('选择结果按固定随机源可复现，且只结算一次', () => {
  const event = getEventById('herb-gather');
  const make = () => {
    const c = createCharacter({ name: '采药', rootId: 'triple', talentId: 'plain' });
    c.realmId = 2;
    c.stones = 50;
    c.exp = 0;
    return c;
  };
  const prepare = (ch) => {
    ch.pendingEvent = { eventId: event.id, atMonth: ch.months };
    return ch;
  };
  const a = prepare(make());
  const b = prepare(make());
  const r1 = applyChoice(a, event.id, 'dig', createRng(2026));
  const r2 = applyChoice(b, event.id, 'dig', createRng(2026));
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.deltas, r2.deltas, '同种子结果必须一致');
  assert.equal(a.stones, b.stones);
  assert.equal(a.hp, b.hp);
});

test('奇遇不会把气血打到 1 以下，也不会让修为超过上限', () => {
  const c = createCharacter({ name: '受击', rootId: 'triple', talentId: 'plain' });
  c.realmId = 5;
  c.hp = 5;
  const cap = getRealm(5).expToNext;
  c.exp = cap - 1;
  // 反复执行所有事件的所有选项，确保数值不越界
  for (const event of EVENTS) {
    if (event.minRealm > c.realmId) continue;
    for (const choice of event.choices) {
      c.hp = Math.max(1, c.hp);
      c.pendingEvent = { eventId: event.id, atMonth: c.months };
      applyChoice(c, event.id, choice.id, createRng(99));
      assert.ok(c.hp >= 1, `${event.id}/${choice.id} 把气血打到 0 以下`);
      assert.ok(c.hp <= maxHp(c), `${event.id}/${choice.id} 让气血超过上限`);
      assert.ok(c.stones >= 0, `${event.id}/${choice.id} 让灵石为负`);
      assert.ok(c.exp <= cap, `${event.id}/${choice.id} 让修为超过上限`);
    }
  }
});

test('没有待处理奇遇时无法结算（P0-1）', () => {
  const c = createCharacter({ name: '错误', rootId: 'triple', talentId: 'plain' });
  const r = applyChoice(c, 'herb-gather', 'dig', createRng(1));
  assert.equal(r.ok, false);
  assert.match(r.reason, /没有待处理/);
});

test('奇遇 ID 不匹配时拒绝结算，且不会重复领取', () => {
  const c = createCharacter({ name: '重复', rootId: 'triple', talentId: 'plain' });
  c.realmId = 2;
  c.stones = 50;
  c.pendingEvent = { eventId: 'herb-gather', atMonth: c.months };
  const wrong = applyChoice(c, 'ancient-cave', 'enter', createRng(1));
  assert.equal(wrong.ok, false, '不同事件不得结算');
  const first = applyChoice(c, 'herb-gather', 'dig', createRng(1));
  assert.equal(first.ok, true);
  assert.equal(c.pendingEvent, null, '结算后必须清空待处理奇遇');
  const again = applyChoice(c, 'herb-gather', 'dig', createRng(1));
  assert.equal(again.ok, false, '同一奇遇不得重复领取');
});

test('寿元已尽时不能历练', () => {
  const c = createCharacter({ name: '将尽', rootId: 'triple', talentId: 'plain' });
  c.months = 200 * 12;
  assert.equal(isDead(c), true);
  const result = startExplore(c, createRng(1));
  assert.equal(result.ok, false);
  assert.equal(result.died, true);
});



