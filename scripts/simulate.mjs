/**
 * 全流程平衡模拟 v3（对应评审 P0「模拟脚本绕过统一行动入口」）
 *
 * 规则
 *  - 所有角色行动都通过 resolveAction() 执行，并采用返回的 result.character；
 *  - 战败后会先「洞府休养」补气血，直到能再次正常行动（记录恢复成本）；
 *  - 操作数 clicks 统计所有玩家交互：闭关 / 凝灵 / 休养 / 历练 / 奇遇选择 / 突破 / 战斗回合
 *  - 三种策略：保守（多闭关少历练）、均衡、冒险（多历练多战斗）
 *
 * 用法：node scripts/simulate.mjs [种子数]
 */
import { createCharacter, ageYears, isDead, lifespanYears, maxHp } from '../src/core/gameState.js';
import { ACTIONS, resolveAction } from '../src/core/actions.js';
import { canBreakthrough } from '../src/core/breakthrough.js';
import { getRealm, MAX_REALM_ID } from '../src/data/realms.js';
import { getEventById, EVENTS } from '../src/data/events.js';
import { pickEnemy } from '../src/data/enemies.js';
import { createRng } from '../src/core/rng.js';

const SEEDS = Number(process.argv[2] || 300);

const COMBOS = [
  ['天灵根', 'heaven', 'genius'],
  ['双灵根', 'dual', 'fortune'],
  ['三灵根', 'triple', 'plain'],
  ['五行杂灵根', 'mixed', 'plain'],
  ['杂灵根+福缘', 'mixed', 'fortune'],
];

/** 三种玩家策略：历练概率 / 是否主动开战 / 气血低于多少就休养 */
const STRATEGIES = {
  保守: { exploreChance: 0.3, fightChance: 0.15, restBelow: 0.6 },
  均衡: { exploreChance: 0.5, fightChance: 0.35, restBelow: 0.45 },
  冒险: { exploreChance: 0.75, fightChance: 0.6, restBelow: 0.25 },
};

function run(rootId, talentId, strategyName, seed) {
  const policy = STRATEGIES[strategyName];
  const rng = createRng(seed);
  let character = createCharacter({ name: 'sim', rootId, talentId });
  const stats = {
    clicks: 0,
    cultivate: 0,
    condense: 0,
    rest: 0,
    explore: 0,
    events: 0,
    combats: 0,
    turns: 0,
    wins: 0,
    losses: 0,
    normalCombats: 0,
    normalWins: 0,
    eliteCombats: 0,
    eliteWins: 0,
    breakthroughOk: 0,
    breakthroughFail: 0,
    recoverySamples: [],
    blocked: 0,
  };

  const apply = (action, payload) => {
    const result = resolveAction(character, action, rng, payload);
    stats.clicks += 1;
    if (!result.ok) return result;
    character = result.character;
    return result;
  };

  let recoveringFromDefeat = false;
  let recoveryActions = 0;

  for (let step = 0; step < 60000; step += 1) {
    if (character.realmId >= MAX_REALM_ID || isDead(character)) break;

    // 1) 待处理奇遇优先解决
    if (character.pendingEvent) {
      const event = getEventById(character.pendingEvent.eventId);
      if (!event) { stats.blocked += 1; break; }
      const choice = event.choices[0];
      const r = apply(ACTIONS.CHOOSE, { eventId: event.id, choiceId: choice.id });
      if (!r.ok) { stats.blocked += 1; break; }
      stats.events += 1;
      continue;
    }

    // 2) 受伤先休养（战败恢复成本统计）
    const hpRatio = character.hp / maxHp(character);
    if (hpRatio < policy.restBelow) {
      const r = apply(ACTIONS.REST);
      if (!r.ok) { stats.blocked += 1; break; }
      stats.rest += 1;
      if (recoveringFromDefeat) recoveryActions += 1;
      continue;
    }
    if (recoveringFromDefeat) {
      stats.recoverySamples.push(recoveryActions);
      recoveringFromDefeat = false;
      recoveryActions = 0;
    }

    // 3) 修为满且灵石够 → 突破
    const check = canBreakthrough(character);
    if (check.ok) {
      const r = apply(ACTIONS.BREAKTHROUGH);
      if (!r.ok) { stats.blocked += 1; break; }
      if (r.detail.success) stats.breakthroughOk += 1;
      else stats.breakthroughFail += 1;
      continue;
    }

    const realm = getRealm(character.realmId);
    const needStones = realm.expToNext !== null && character.exp >= realm.expToNext && character.stones < realm.costStones;
    if (needStones) {
      apply(ACTIONS.CONDENSE);
      stats.condense += 1;
      continue;
    }

    // 4) 历练 or 闭关
    if (rng.chance(policy.exploreChance)) {
      const r = apply(ACTIONS.EXPLORE);
      if (!r.ok) { stats.blocked += 1; break; }
      stats.explore += 1;
      // 上次有奇遇未解决时，下一轮会先处理奇遇
      if (r.detail.event && rng.chance(policy.fightChance)) {
        const enemy = pickEnemy(character, rng);
        if (enemy) {
          // 遇战必须先了结奇遇（守卫会拒绝），所以先记录再去解决
          const start = resolveAction({ ...character, pendingEvent: null }, ACTIONS.COMBAT_START, rng, { enemyId: enemy.id });
          // 简化：把奇遇结算掉再开战
          const event = getEventById(character.pendingEvent.eventId);
          const choice = event.choices[0];
          const resolved = apply(ACTIONS.CHOOSE, { eventId: event.id, choiceId: choice.id });
          if (resolved.ok) stats.events += 1;
          const battle = apply(ACTIONS.COMBAT_START, { enemyId: enemy.id });
          if (battle.ok) {
            stats.combats += 1;
            const tier = enemy.tier === 'elite' ? 'elite' : 'normal';
            if (tier === 'elite') stats.eliteCombats += 1;
            else stats.normalCombats += 1;
            let guard = 0;
            let outcome = null;
            while (character.combat && guard < 100) {
              const turn = apply(ACTIONS.COMBAT_TURN, { action: 'attack' });
              stats.turns += 1;
              guard += 1;
              if (!turn.ok) break;
              if (turn.detail.finished) outcome = turn.detail.result;
            }
            if (outcome === 'victory') {
              stats.wins += 1;
              if (tier === 'elite') stats.eliteWins += 1;
              else stats.normalWins += 1;
            } else if (outcome === 'defeat') {
              stats.losses += 1;
              recoveringFromDefeat = true;
              recoveryActions = 0;
            }
          }
        }
      }
      continue;
    }

    apply(ACTIONS.CULTIVATE);
    stats.cultivate += 1;
  }

  return {
    cleared: character.realmId >= MAX_REALM_ID,
    dead: isDead(character),
    years: (character.months - 16 * 12) / 12,
    age: ageYears(character),
    lifespan: lifespanYears(character),
    ...stats,
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))];
}

const lines = [`每种组合 ${SEEDS} 个固定种子 · 三种策略对比\n`];
for (const [strategyName] of Object.entries(STRATEGIES)) {
  const rows = [];
  for (const [label, rootId, talentId] of COMBOS) {
    const runs = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) runs.push(run(rootId, talentId, strategyName, seed));
    const sum = (k) => runs.reduce((a, r) => a + r[k], 0);
    const recovery = runs.flatMap((r) => r.recoverySamples);
    rows.push({
      策略: strategyName,
      组合: label,
      通关率: ((runs.filter((r) => r.cleared).length / runs.length) * 100).toFixed(1) + '%',
      寿尽: runs.filter((r) => r.dead).length,
      阻塞: runs.filter((r) => r.blocked > 0).length,
      P50操作: percentile(runs.map((r) => r.clicks), 50),
      P95操作: percentile(runs.map((r) => r.clicks), 95),
      'P50游戏年': percentile(runs.map((r) => r.years), 50).toFixed(1),
      历练: (sum('explore') / runs.length).toFixed(1),
      战斗: (sum('combats') / runs.length).toFixed(1),
      总胜率: ((sum('wins') / Math.max(1, sum('combats'))) * 100).toFixed(1) + '%',
      普通胜率: ((sum('normalWins') / Math.max(1, sum('normalCombats'))) * 100).toFixed(1) + '%',
      精英胜率: ((sum('eliteWins') / Math.max(1, sum('eliteCombats'))) * 100).toFixed(1) + '%',
      战败: sum('losses'),
      'P50恢复': percentile(recovery, 50),
      'P95恢复': percentile(recovery, 95),
      休养: (sum('rest') / runs.length).toFixed(1),
    });
  }
  const headers = Object.keys(rows[0]);
  lines.push('### ' + strategyName + '型');
  lines.push('| ' + headers.join(' | ') + ' |');
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
  for (const row of rows) lines.push('| ' + headers.map((h) => row[h]).join(' | ') + ' |');
  lines.push('');
}
console.log(lines.join('\n'));
console.log(`事件库: ${EVENTS.length} 条`);
