/**
 * 战斗回合的「展示时间轴」。
 *
 * 设计原则（对应 ChatGPT v0.10 评审）：
 *  - 核心结算在 resolveAction 里只执行一次；这里只描述「如何依次展示结算结果」
 *  - 动画阶段绝不修改角色数值，只操作 DOM
 *  - 固定节奏：蓄势 0–80 / 突进 80–180 / 敌人受击 180–400 / 敌人反击 400–650 / 玩家受击 650–850 / 释放 850
 *  - 减少动画模式：一次性展示、立刻释放操作
 *  - 纯函数，可被单元测试覆盖
 */

export const TURN_TIMING = {
  windup: 0,
  playerLunge: 80,
  enemyHit: 180,
  enemyCounter: 400,
  playerHurt: 650,
  release: 850,
};

export const TIMELINE_KINDS = new Set([
  'windup',
  'playerLunge',
  'enemyHurt',
  'applyEnemyBar',
  'showEnemyDamage',
  'enemyCounter',
  'playerHurt',
  'applyMyBar',
  'showMyDamage',
  'healNumber',
  'release',
]);

/**
 * @param {object} opts
 * @param {'attack'|'skill'|'item'|'flee'} opts.action
 * @param {number} opts.enemyDamage 本回合对妖兽造成的伤害（仅用于展示）
 * @param {number} opts.myDamage    本回合自身受到的伤害
 * @param {number} opts.healed      本回合回复量
 * @param {boolean} opts.isSkill    是否技能（影响伤害数字样式，不叫暴击）
 * @param {boolean} opts.reduced    是否减少动画
 * @returns {{steps:Array<{at:number, kind:string, value?:number, isSkill?:boolean}>, total:number}}
 */
export const SPEED_FACTORS = { fast: 550 / 850, full: 1, reduced: 0 };

export function buildTurnTimeline({
  action,
  enemyDamage = 0,
  myDamage = 0,
  healed = 0,
  isSkill = false,
  speed = 'fast',
  reduced = false,
} = {}) {
  const steps = [];
  const factor = SPEED_FACTORS[speed] === undefined ? SPEED_FACTORS.fast : SPEED_FACTORS[speed];
  const push = (at, kind, extra = {}) => steps.push({ at: Math.round(at * factor), kind, ...extra });
  const instant = factor === 0 || reduced;

  if (instant) {
    // 减少动画：不播过程，只把结果一次性呈现，并立即交出操作权
    if (enemyDamage) {
      push(0, 'applyEnemyBar');
      push(0, 'showEnemyDamage', { value: enemyDamage, isSkill });
    }
    if (myDamage) {
      push(0, 'applyMyBar');
      push(0, 'showMyDamage', { value: myDamage });
    }
    if (healed) push(0, 'healNumber', { value: healed });
    push(0, 'release');
    return { steps, total: 0, speed: 'reduced' };
  }

  if (action === 'flee') {
    push(0, 'playerHurt');
    push(120, 'applyMyBar');
    if (myDamage) push(120, 'showMyDamage', { value: myDamage });
    push(420, 'release');
    return { steps, total: Math.round(420 * factor), speed };
  }

  if (action === 'item') {
    if (healed) push(0, 'healNumber', { value: healed });
    push(140, 'enemyCounter');
    push(320, 'playerHurt');
    push(320, 'applyMyBar');
    if (myDamage) push(320, 'showMyDamage', { value: myDamage });
    push(700, 'release');
    return { steps, total: Math.round(700 * factor), speed };
  }

  // 常规攻击 / 技能
  push(TURN_TIMING.windup, 'windup');
  push(TURN_TIMING.playerLunge, 'playerLunge');
  if (enemyDamage) {
    push(TURN_TIMING.enemyHit, 'enemyHurt');
    push(TURN_TIMING.enemyHit, 'applyEnemyBar');
    push(TURN_TIMING.enemyHit, 'showEnemyDamage', { value: enemyDamage, isSkill });
  }
  if (myDamage) {
    push(TURN_TIMING.enemyCounter, 'enemyCounter');
    push(TURN_TIMING.playerHurt, 'playerHurt');
    push(TURN_TIMING.playerHurt, 'applyMyBar');
    push(TURN_TIMING.playerHurt, 'showMyDamage', { value: myDamage });
  }
  push(TURN_TIMING.release, 'release');
  return { steps, total: Math.round(TURN_TIMING.release * factor), speed };
}

/** 时间轴自检：时间单调不减、类型合法、必须以 release 结束 */
export function validateTimeline(timeline) {
  if (!timeline || !Array.isArray(timeline.steps) || timeline.steps.length === 0) return '时间轴为空';
  let last = -1;
  for (const step of timeline.steps) {
    if (!TIMELINE_KINDS.has(step.kind)) return `未知动画阶段：${step.kind}`;
    if (typeof step.at !== 'number' || step.at < 0) return '阶段时间非法';
    if (step.at < last) return '阶段时间必须单调不减';
    last = step.at;
  }
  if (timeline.steps[timeline.steps.length - 1].kind !== 'release') return '时间轴必须以 release 结束';
  if (timeline.total > 1200) return '整段动画过长';
  return null;
}


