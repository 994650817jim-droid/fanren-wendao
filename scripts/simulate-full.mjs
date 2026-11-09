/**
 * 完整成长模拟 v2（ChatGPT v0.17.1 修复版）
 *
 * 修复点：
 *  1) Boss 每次尝试记录结束原因：victory / defeat / max_rounds / start_failed / turn_rejected / loop_guard
 *  2) Boss 战前回满气血（与孤立 Boss 模拟对齐），并记录起始状态
 *  3) 任何境界都优先处理 pendingEvent；只有真正历练才计入额外历练次数
 *  4) 连续剧情统计改为读取 story.completedEvents / seenEvents，而不是局部计数器
 *  5) 奇遇选项支持三种策略：优先丹药 / 优先修为 / 随机
 *
 * 用法：node scripts/simulate-full.mjs [种子数=100] [策略=pill|exp|random|all]
 */
import { createCharacter, isDead, maxHp } from '../src/core/gameState.js';
import { ACTIONS, resolveAction } from '../src/core/actions.js';
import { getRealm } from '../src/data/realms.js';
import { getEventById } from '../src/data/events.js';
import { pickEnemy } from '../src/data/enemies.js';
import { BOSS } from '../src/data/boss.js';
import { MAX_ROUNDS } from '../src/core/combat.js';
import { PILL_MAX_PER_BATTLE, PILL_PRICE } from '../src/core/inventory.js';
import { createRng } from '../src/core/rng.js';

const SEEDS = Number(process.argv[2] || 100);
const POLICY_ARG = process.argv[3] || 'all';
const BOSS_REALM = 13;
const CHAIN_IDS = ['chain-stele', 'chain-cave', 'chain-furnace', 'chain-lastword'];
const REST_HEAL_RATIO = 0.35;

const COMBOS = [
  ['天灵根', 'heaven', 'genius'],
  ['双灵根', 'dual', 'fortune'],
  ['三灵根', 'triple', 'plain'],
  ['五行杂灵根', 'mixed', 'plain'],
  ['杂灵根+福缘', 'mixed', 'fortune'],
];

const POLICIES = {
  pill: (a, b) => score(b, 'pill') - score(a, 'pill'),
  exp: (a, b) => score(b, 'exp') - score(a, 'exp'),
  random: null,
};

function score(choice, kind) {
  let total = 0;
  for (const outcome of choice.outcomes || []) {
    for (const effect of outcome.effects || []) {
      if (kind === 'pill' && effect.type === 'item') total += (effect.count || 0) * 10;
      if (kind === 'pill' && effect.type === 'exp') total += (effect.ratio || 0) * 4;
      if (kind === 'pill' && effect.type === 'stones') total += (effect.value || 0) / 20;
      if (kind === 'exp') total += (effect.ratio || 0) * 10 + (effect.type === 'stones' ? (effect.value || 0) / 40 : 0);
    }
  }
  return total;
}

function pickChoice(event, policy, rng) {
  const choices = [...event.choices];
  if (!POLICIES[policy]) return choices[rng.int(0, choices.length - 1)];
  return choices.sort((a, b) => POLICIES[policy](a, b))[0];
}

function runOne(rootId, talentId, seed, policy) {
  const rng = createRng(seed);
  let character = createCharacter({ name: 'sim', rootId, talentId });
  const initialPills = character.inventory.healingPill;

  const stats = {
    freePills: 0,
    boughtPills: 0,
    boughtCost: 0,
    consumedPills: 0,
    steps: 0,
    stuck: false,
    conservationOk: true,
    bossAttempts: [],
    cleared: false,
    reachedBoss: false,
  };

  const apply = (action, payload) => {
    const result = resolveAction(character, action, rng, payload);
    stats.steps += 1;
    if (result.ok) character = result.character;
    return result;
  };

  const resolvePending = () => {
    const event = getEventById(character.pendingEvent.eventId);
    if (!event) {
      character.pendingEvent = null;
      return false;
    }
    const choice = pickChoice(event, policy, rng);
    const before = character.inventory.healingPill;
    const resolved = apply(ACTIONS.CHOOSE, { eventId: event.id, choiceId: choice.id });
    if (!resolved.ok) {
      character.pendingEvent = null;
      return false;
    }
    stats.freePills += Math.max(0, (character.inventory.healingPill || 0) - before);
    return true;
  };

  const buyPills = (count) => {
    const before = character.stones;
    const result = apply(ACTIONS.BUY_PILL, { count });
    if (!result.ok) return false;
    stats.boughtPills += count;
    stats.boughtCost += before - character.stones;
    return true;
  };

  const restToFull = () => {
    for (let i = 0; i < 8 && character.hp < maxHp(character); i += 1) {
      if (!apply(ACTIONS.REST).ok) break;
    }
  };

  const fightBoss = (attempt) => {
    const record = {
      attempt,
      startHp: character.hp,
      maxHp: maxHp(character),
      startStones: character.stones,
      pillsBefore: character.inventory.healingPill,
      rounds: 0,
      result: null,
      reason: null,
      enemyHpRemaining: null,
    };
    const start = apply(ACTIONS.COMBAT_START, { enemyId: BOSS.id });
    if (!start.ok) {
      record.result = 'start_failed';
      record.reason = start.error;
      stats.bossAttempts.push(record);
      return record;
    }
    stats.reachedBoss = true;
    let guard = 0;
    while (character.combat && guard < MAX_ROUNDS + 5) {
      guard += 1;
      const telegraph = Boolean(character.combat.telegraph);
      const hpRatio = character.hp / maxHp(character);
      const pills = character.inventory ? character.inventory.healingPill : 0;
      let action;
      if (telegraph) action = 'defend';
      else if (hpRatio < 0.45 && pills > 0 && (character.combat.pillsUsed || 0) < PILL_MAX_PER_BATTLE) action = 'item';
      else if (character.combat.cooldown === 0) action = 'skill';
      else action = 'attack';
      const pillsBefore = character.inventory.healingPill;
      const roundBefore = character.combat.round;
      const turn = apply(ACTIONS.COMBAT_TURN, { action });
      if (!turn.ok) {
        record.result = 'turn_rejected';
        record.reason = turn.error;
        break;
      }
      record.rounds = roundBefore;
      if (action === 'item') {
        stats.consumedPills += Math.max(0, pillsBefore - (character.inventory ? character.inventory.healingPill : 0));
      }
      if (turn.detail && turn.detail.finished) {
        record.result = turn.detail.result;
        record.reason = 'settled';
        record.enemyHpRemaining = 0;
        break;
      }
    }
    if (!record.result) {
      record.result = 'max_rounds';
      record.reason = character.combat ? 'still_active_after_guard' : 'unknown';
      record.enemyHpRemaining = character.combat ? character.combat.enemyHp : null;
      stats.bossAttempts.push(record);
      return record;
    }
    if (record.enemyHpRemaining === null) {
      record.enemyHpRemaining = turn_enemy_hp(record);
    }
    stats.bossAttempts.push(record);
    return record;
  };

  const turn_enemy_hp = () => (character.combat ? character.combat.enemyHp : 0);

  // 成长阶段
  let maxRealmExplores = 0;
  for (let step = 0; step < 5000; step += 1) {
    if (isDead(character)) break;

    // 任何境界都优先处理待处理奇遇（ChatGPT 指出的问题）
    if (character.pendingEvent) {
      resolvePending();
      continue;
    }

    const atMax = character.realmId >= BOSS_REALM;
    if (atMax && maxRealmExplores >= 30) break;

    if (character.hp / maxHp(character) < 0.4) {
      if (!apply(ACTIONS.REST).ok) break;
      continue;
    }

    const realm = getRealm(character.realmId);
    if (!atMax && realm.expToNext !== null && character.exp >= realm.expToNext) {
      if (character.stones >= (realm.costStones || 0)) {
        if (!apply(ACTIONS.BREAKTHROUGH).ok) break;
        continue;
      }
      if (character.stones >= PILL_PRICE * 3 + 8) buyPills(1);
      if (!apply(ACTIONS.CONDENSE).ok) break;
      continue;
    }

    const reserve = (realm.costStones || 0) + 16;
    if (character.stones >= reserve + 24 && character.inventory.healingPill < PILL_MAX_PER_BATTLE * 2) {
      buyPills(1);
      continue;
    }

    const roll = rng.float();
    if (roll < 0.45) {
      const explore = apply(ACTIONS.EXPLORE);
      if (!explore.ok) { stats.stuck = true; break; }
      if (atMax) maxRealmExplores += 1;
      continue;
    }
    if (roll < 0.7) {
      if (!apply(ACTIONS.CULTIVATE).ok) break;
      continue;
    }
    const enemy = pickEnemy(character, rng);
    if (!enemy) { apply(ACTIONS.CULTIVATE); continue; }
    const start = apply(ACTIONS.COMBAT_START, { enemyId: enemy.id });
    if (start.ok) {
      let guard = 0;
      while (character.combat && guard < MAX_ROUNDS + 5) {
        guard += 1;
        const telegraph = Boolean(character.combat.telegraph);
        const action = telegraph ? 'defend' : character.combat.cooldown === 0 ? 'skill' : 'attack';
        const turn = apply(ACTIONS.COMBAT_TURN, { action });
        if (!turn.ok || (turn.detail && turn.detail.finished)) break;
      }
    }
  }

  // Boss：结清奇遇 → 备药 → 回满气血 → 最多 5 次尝试
  while (character.pendingEvent) {
    if (!resolvePending()) break;
  }
  if (!isDead(character) && character.realmId >= BOSS_REALM) {
    for (let attempt = 1; attempt <= 5 && !character.victory && !isDead(character); attempt += 1) {
      while (character.inventory.healingPill < PILL_MAX_PER_BATTLE && character.stones >= PILL_PRICE) {
        if (!buyPills(1)) break;
      }
      restToFull();
      if (character.hp < maxHp(character) * 0.95) break;
      fightBoss(attempt);
      if (character.victory) break;
    }
    stats.cleared = character.victory === true;
  }

  stats.finalRealm = character.realmId;
  stats.finalPills = character.inventory ? character.inventory.healingPill : 0;
  stats.finalStones = character.stones;
  stats.dead = isDead(character);
  stats.conservationOk =
    stats.finalPills === initialPills + stats.freePills + stats.boughtPills - stats.consumedPills;

  // 连续剧情：以真实 story 记录为准
  const completed = new Set((character.story && character.story.completedEvents) || []);
  const seen = new Set((character.story && character.story.seenEvents) || []);
  stats.chainSeen = Object.fromEntries(CHAIN_IDS.map((id) => [id, seen.has(id) ? 1 : 0]));
  stats.chainDone = Object.fromEntries(CHAIN_IDS.map((id) => [id, completed.has(id) ? 1 : 0]));

  return stats;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))];
}

const policiesToRun = POLICY_ARG === 'all' ? ['pill', 'exp', 'random'] : [POLICY_ARG];

for (const policy of policiesToRun) {
  console.log(`\n=== 奇遇策略：${policy} ===`);
  const rows = [];
  const chainTotals = { seen: Object.fromEntries(CHAIN_IDS.map((id) => [id, 0])), done: Object.fromEntries(CHAIN_IDS.map((id) => [id, 0])), runs: 0 };
  const reasons = {};
  for (const [label, rootId, talentId] of COMBOS) {
    const results = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const r = runOne(rootId, talentId, seed, policy);
      results.push(r);
      chainTotals.runs += 1;
      for (const id of CHAIN_IDS) {
        chainTotals.seen[id] += r.chainSeen[id];
        chainTotals.done[id] += r.chainDone[id];
      }
      for (const attempt of r.bossAttempts) {
        const key = `${attempt.result}${attempt.reason ? '/' + attempt.reason : ''}`;
        reasons[key] = (reasons[key] || 0) + 1;
      }
    }
    const freePills = results.map((r) => r.freePills);
    const wins = results.filter((r) => r.cleared);
    rows.push({
      组合: label,
      通关率: ((wins.length / results.length) * 100).toFixed(1) + '%',
      '免费丹药': (freePills.reduce((a, b) => a + b, 0) / results.length).toFixed(2),
      '免费P50': percentile(freePills, 50),
      '免费P95': percentile(freePills, 95),
      零免费局: ((results.filter((r) => r.freePills === 0).length / results.length) * 100).toFixed(0) + '%',
      购买: (results.reduce((a, r) => a + r.boughtPills, 0) / results.length).toFixed(2),
      消耗: (results.reduce((a, r) => a + r.consumedPills, 0) / results.length).toFixed(2),
      最终库存: (results.reduce((a, r) => a + r.finalPills, 0) / results.length).toFixed(2),
      Boss尝试: (results.reduce((a, r) => a + r.bossAttempts.length, 0) / results.length).toFixed(2),
      守恒失败: results.filter((r) => !r.conservationOk).length,
    });
  }
  const headers = Object.keys(rows[0]);
  console.log('| ' + headers.join(' | ') + ' |');
  console.log('| ' + headers.map(() => '---').join(' | ') + ' |');
  for (const row of rows) console.log('| ' + headers.map((h) => row[h]).join(' | ') + ' |');

  console.log('\nBoss 尝试结束原因分布：');
  for (const [key, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${key}: ${count}`);
  }
  console.log('\n连续剧情（以 story.completedEvents 为准）：');
  for (const id of CHAIN_IDS) {
    console.log(
      `- ${id}: 触发 ${chainTotals.seen[id]} (${((chainTotals.seen[id] / chainTotals.runs) * 100).toFixed(1)}%) / 完成 ${chainTotals.done[id]} (${((chainTotals.done[id] / chainTotals.runs) * 100).toFixed(1)}%)`
    );
  }
}

