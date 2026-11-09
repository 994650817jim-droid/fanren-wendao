/**
 * 战斗展示时间轴测试（对应 ChatGPT v0.10 评审「战斗测试覆盖不足」）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTurnTimeline, validateTimeline, TURN_TIMING } from '../src/core/turnTimeline.js';

test('完整模式下普通攻击符合 0/80/180/400/650/850 节奏', () => {
  const tl = buildTurnTimeline({ action: 'attack', enemyDamage: 9, myDamage: 6, speed: 'full' });
  assert.equal(validateTimeline(tl), null);
  const kinds = tl.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['windup', 'playerLunge', 'enemyHurt', 'applyEnemyBar', 'showEnemyDamage', 'enemyCounter', 'playerHurt', 'applyMyBar', 'showMyDamage', 'release']);
  assert.equal(tl.steps.find((s) => s.kind === 'playerLunge').at, TURN_TIMING.playerLunge);
  assert.equal(tl.steps.find((s) => s.kind === 'enemyHurt').at, TURN_TIMING.enemyHit);
  assert.equal(tl.steps.find((s) => s.kind === 'enemyCounter').at, TURN_TIMING.enemyCounter);
  assert.equal(tl.steps.find((s) => s.kind === 'playerHurt').at, TURN_TIMING.playerHurt);
  assert.equal(tl.steps[tl.steps.length - 1].at, TURN_TIMING.release);
  assert.ok(tl.total >= 600 && tl.total <= 900, '整段节奏应在 0.6~0.9 秒');
});

test('技能只改变伤害数字样式，不新增机制（不叫暴击）', () => {
  const tl = buildTurnTimeline({ action: 'skill', enemyDamage: 20, myDamage: 0, isSkill: true, speed: 'full' });
  const dmg = tl.steps.find((s) => s.kind === 'showEnemyDamage');
  assert.equal(dmg.isSkill, true);
  assert.equal(dmg.value, 20);
  assert.equal(tl.steps.some((s) => s.kind === 'enemyCounter'), false, '未受伤时不应出现反击阶段');
});

test('服丹/逃跑有各自更短的时间轴', () => {
  const item = buildTurnTimeline({ action: 'item', healed: 30, myDamage: 5 });
  assert.equal(validateTimeline(item), null);
  assert.ok(item.total <= 800);
  assert.ok(item.steps.some((s) => s.kind === 'healNumber'));

  const flee = buildTurnTimeline({ action: 'flee', myDamage: 8 });
  assert.equal(validateTimeline(flee), null);
  assert.ok(flee.total <= 500);
  assert.equal(flee.steps.some((s) => s.kind === 'windup'), false, '逃跑不播出手动作');
});

test('减少动画模式：一次展示、立刻释放，总时长 0', () => {
  const tl = buildTurnTimeline({ action: 'attack', enemyDamage: 9, myDamage: 6, reduced: true });
  assert.equal(tl.total, 0);
  assert.equal(tl.steps[tl.steps.length - 1].kind, 'release');
  assert.ok(tl.steps.every((s) => s.at === 0));
  assert.equal(validateTimeline(tl), null);
});

test('每个阶段只做展示，不携带任何会改数值的指令', () => {
  const tl = buildTurnTimeline({ action: 'attack', enemyDamage: 9, myDamage: 6 });
  const allowed = new Set(['windup', 'playerLunge', 'enemyHurt', 'applyEnemyBar', 'showEnemyDamage', 'enemyCounter', 'playerHurt', 'applyMyBar', 'showMyDamage', 'healNumber', 'release']);
  for (const step of tl.steps) {
    assert.ok(allowed.has(step.kind), `出现未知阶段 ${step.kind}`);
    assert.equal(Object.prototype.hasOwnProperty.call(step, 'damage'), false, '阶段不得直接携带扣血指令');
  }
});

test('时间轴校验能拦住非法数据', () => {
  assert.equal(validateTimeline(null), '时间轴为空');
  assert.equal(validateTimeline({ steps: [] }), '时间轴为空');
  assert.equal(validateTimeline({ steps: [{ at: 0, kind: 'unknown' }] }), '未知动画阶段：unknown');
  assert.equal(validateTimeline({ steps: [{ at: 10, kind: 'windup' }, { at: 5, kind: 'release' }] }), '阶段时间必须单调不减');
  assert.equal(validateTimeline({ steps: [{ at: 0, kind: 'windup' }], total: 0 }), '时间轴必须以 release 结束');
});

test('三档速度：fast ≈550ms、full ≈850ms、reduced 立即释放', () => {
  const fast = buildTurnTimeline({ action: 'attack', enemyDamage: 9, myDamage: 6, speed: 'fast' });
  const full = buildTurnTimeline({ action: 'attack', enemyDamage: 9, myDamage: 6, speed: 'full' });
  const reduced = buildTurnTimeline({ action: 'attack', enemyDamage: 9, myDamage: 6, speed: 'reduced' });

  assert.ok(fast.total >= 480 && fast.total <= 620, `fast 总时长 ${fast.total} 应接近 550`);
  assert.equal(full.total, 850);
  assert.equal(reduced.total, 0);

  // 三档的阶段种类与顺序必须完全一致（速度不能改变逻辑）
  const kinds = (tl) => tl.steps.map((s) => s.kind);
  assert.deepEqual(kinds(fast), kinds(full));
  assert.deepEqual(kinds(reduced).filter((k) => k !== 'windup' && k !== 'enemyCounter' && k !== 'playerHurt'), ['applyEnemyBar', 'showEnemyDamage', 'applyMyBar', 'showMyDamage', 'release']);
});

test('速度缩放后时间仍然单调不减且以 release 结束', () => {
  for (const speed of ['fast', 'full', 'reduced']) {
    const tl = buildTurnTimeline({ action: 'attack', enemyDamage: 10, myDamage: 5, speed });
    assert.equal(validateTimeline(tl), null, `${speed} 时间轴非法`);
  }
});
