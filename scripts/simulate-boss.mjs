/**
 * Boss 平衡模拟 v2（ChatGPT v0.15 指令 05）
 *
 * 与 v1 的区别：丹药现在是真实背包——准备型策略要先在洞府用灵石买丹，
 * 再在战斗中消耗库存（每场最多 2 枚）。所有动作都走 resolveAction。
 *
 * 用法：node scripts/simulate-boss.mjs [种子数=1000]
 */
import { createCharacter, maxHp } from '../src/core/gameState.js';
import { ACTIONS, resolveAction } from '../src/core/actions.js';
import { BOSS } from '../src/data/boss.js';
import { PILL_MAX_PER_BATTLE, PILL_PRICE } from '../src/core/inventory.js';
import { createRng } from '../src/core/rng.js';

const SEEDS = Number(process.argv[2] || 1000);
const REST_HEAL_RATIO = 0.35;
const START_STONES = 120;

function makeCharacter(stones = START_STONES) {
  const c = createCharacter({ name: 'sim', rootId: 'heaven', talentId: 'genius' });
  c.realmId = 13;
  c.hp = maxHp(c);
  c.stones = stones;
  c.inventory = { healingPill: 0 };
  return c;
}

const STRATEGIES = {
  强攻型: { buy: 0, decides: (s) => (s.telegraph ? 'attack' : 'attack') },
  防御型: { buy: 0, decides: (s) => (s.telegraph || s.residual ? 'defend' : 'attack') },
  只服丹型: {
    buy: PILL_MAX_PER_BATTLE,
    decides: (s) => {
      if (s.hpRatio < 0.45 && s.pills > 0) return 'item';
      return 'attack';
    },
  },
  普通玩家型: {
    buy: 1,
    decides: (s, rng) => {
      // 普通玩家：30% 概率忽略预警、丹药时机不稳定、技能用得随意
      if ((s.telegraph || s.residual) && rng.chance(0.7)) return 'defend';
      if (s.hpRatio < 0.6 && s.pills > 0 && rng.chance(0.45)) return 'item';
      if (rng.chance(0.35)) return 'skill';
      return 'attack';
    },
  },
  准备型: {
    buy: PILL_MAX_PER_BATTLE,
    decides: (s) => {
      if (s.telegraph || s.residual) return 'defend';
      if (s.hpRatio < 0.45 && s.pills > 0) return 'item';
      return 'attack';
    },
  },
};

function simulate(strategyName, seed) {
  const policy = STRATEGIES[strategyName];
  const rng = createRng(seed);
  let character = makeCharacter();
  const stats = {
    rounds: 0,
    pillsBought: 0,
    pillsUsed: 0,
    stonesSpentOnPills: 0,
    thunderHits: 0,
    outcome: null,
  };

  // 洞府准备：买丹（走 resolveAction，原子结算）
  if (policy.buy > 0) {
    const buy = resolveAction(character, ACTIONS.BUY_PILL, rng, { count: policy.buy });
    if (buy.ok) {
      character = buy.character;
      stats.pillsBought = policy.buy;
      stats.stonesSpentOnPills = policy.buy * PILL_PRICE;
    }
  }

  const start = resolveAction(character, ACTIONS.COMBAT_START, rng, { enemyId: BOSS.id });
  if (!start.ok) return { ...stats, outcome: 'cannot-start' };
  character = start.character;

  let guard = 0;
  while (character.combat && guard < 200) {
    guard += 1;
    const beforeHp = character.hp;
    const wasTelegraph = Boolean(character.combat.telegraph);
    const pills = character.inventory ? character.inventory.healingPill : 0;
    let action = policy.decides({
      telegraph: wasTelegraph,
      residual: Boolean(character.combat && character.combat.residualThunder > 0),
      hpRatio: character.hp / maxHp(character),
      pills,
    }, rng);
    if (action === 'attack' && character.combat.cooldown === 0) action = 'skill';
    if (action === 'skill' && character.combat.cooldown > 0) action = 'attack';
    if (action === 'item' && ((character.combat.pillsUsed || 0) >= PILL_MAX_PER_BATTLE || character.inventory.healingPill <= 0)) action = 'attack';

    const result = resolveAction(character, ACTIONS.COMBAT_TURN, rng, { action });
    if (!result.ok) break;
    character = result.character;
    stats.rounds += 1;
    if (action === 'item') stats.pillsUsed += 1;
    if (wasTelegraph && character.hp < beforeHp) stats.thunderHits += 1;

    if (result.detail && result.detail.finished) {
      stats.outcome = result.detail.result;
      break;
    }
  }

  stats.victory = character.victory === true;
  stats.finalHp = character.hp;
  stats.finalHpRatio = character.hp / maxHp(character);
  stats.stonesLeft = character.stones;
  stats.inventoryLeft = character.inventory ? character.inventory.healingPill : 0;

  if (stats.outcome === 'defeat') {
    const heal = Math.round(maxHp(character) * REST_HEAL_RATIO);
    const target = Math.round(maxHp(character) * 0.7);
    stats.recoveryActions = Math.ceil(Math.max(0, target - character.hp) / heal);
  } else {
    stats.recoveryActions = 0;
  }
  return stats;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))];
}

const rows = [];
for (const strategyName of Object.keys(STRATEGIES)) {
  const results = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) results.push(simulate(strategyName, seed));
  const wins = results.filter((r) => r.outcome === 'victory');
  const defeats = results.filter((r) => r.outcome === 'defeat');
  const roundWins = wins.map((r) => r.rounds);
  rows.push({
    策略: strategyName,
    '胜率': ((wins.length / results.length) * 100).toFixed(1) + '%',
    'P50回合': percentile(roundWins, 50),
    'P95回合': percentile(roundWins, 95),
    '平均买丹': (results.reduce((a, r) => a + r.pillsBought, 0) / results.length).toFixed(2),
    '平均服丹': (results.reduce((a, r) => a + r.pillsUsed, 0) / results.length).toFixed(2),
    '平均药费灵石': Math.round(results.reduce((a, r) => a + r.stonesSpentOnPills, 0) / results.length),
    '胜利样本平均余额': Math.round(wins.reduce((a, r) => a + r.stonesLeft, 0) / Math.max(1, wins.length)),
    '全样本平均余额': Math.round(results.reduce((a, r) => a + r.stonesLeft, 0) / results.length),
    '胜利残血%': wins.length
      ? ((wins.reduce((a, r) => a + r.finalHpRatio, 0) / wins.length) * 100).toFixed(1) + '%'
      : '—',
    'P50恢复次数': percentile(defeats.map((r) => r.recoveryActions), 50),
    'P95恢复次数': percentile(defeats.map((r) => r.recoveryActions), 95),
  });
}

const headers = Object.keys(rows[0]);
console.log(`Boss 平衡模拟 v2（真实背包 + 洞府买丹）：${SEEDS} 种子 × 3 策略\n`);
console.log('| ' + headers.join(' | ') + ' |');
console.log('| ' + headers.map(() => '---').join(' | ') + ' |');
for (const row of rows) console.log('| ' + headers.map((h) => row[h]).join(' | ') + ' |');
console.log(`\nBoss：${BOSS.name}｜${BOSS.hp} 血 / 攻击 ${BOSS.atk} / 雷霆 ${BOSS.thunderScale}x｜起始灵石 ${START_STONES}（未含 Boss 奖励 180）｜余额口径：胜利样本=仅通关局；全样本=含战败局`);




