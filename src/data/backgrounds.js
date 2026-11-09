/**
 * 灵根与天赋表。
 * 原则：最好的组合与最差的组合差距明显，但最差组合也能在寿元内走完全程。
 */

export const SPIRIT_ROOTS = [
  { id: 'heaven', name: '天灵根', mult: 1.5, weight: 5,  desc: '万中无一，灵气自来朝拜。修炼速度极快。' },
  { id: 'dual',   name: '双灵根', mult: 1.2, weight: 25, desc: '资质上佳，可同时驾驭两种灵气。' },
  { id: 'triple', name: '三灵根', mult: 1.0, weight: 40, desc: '中人之姿，稳扎稳打亦可问道。' },
  { id: 'mixed',  name: '五行杂灵根', mult: 0.8, weight: 30, desc: '灵根驳杂，修行慢，但心性坚韧。' },
];

export const TALENTS = [
  { id: 'genius',  name: '修炼天才', cultMult: 1.25, breakthroughBonus: 0.00, hpMult: 1.0, weight: 15, desc: '悟性超群，闭关所获比常人多两成半。' },
  { id: 'fortune', name: '福缘深厚', cultMult: 1.00, breakthroughBonus: 0.05, hpMult: 1.0, weight: 20, desc: '逢凶化吉，突破时成功率略高。' },
  { id: 'alchemy', name: '炼丹奇才', cultMult: 1.05, breakthroughBonus: 0.02, hpMult: 1.0, weight: 20, desc: '精通丹道，吐纳效率略高，突破更稳。' },
  { id: 'sturdy',  name: '体魄强健', cultMult: 1.00, breakthroughBonus: 0.00, hpMult: 1.2, weight: 20, desc: '根骨强悍，气血上限比常人多两成。' },
  { id: 'plain',   name: '资质平平', cultMult: 1.00, breakthroughBonus: 0.00, hpMult: 1.0, weight: 25, desc: '无甚出奇，只能靠时间磨。' },
];

export const BASE_LIFESPAN = 90;
export const BASE_HP = 100;
export const START_AGE_YEARS = 16;

function findById(list, id) {
  return list.find((item) => item.id === id) || null;
}

export function getRoot(id) {
  return findById(SPIRIT_ROOTS, id);
}

export function getTalent(id) {
  return findById(TALENTS, id);
}

/** 按权重抽一个灵根 */
export function rollRoot(rng) {
  const total = SPIRIT_ROOTS.reduce((s, r) => s + r.weight, 0);
  let roll = rng.float() * total;
  for (const root of SPIRIT_ROOTS) {
    roll -= root.weight;
    if (roll <= 0) return root;
  }
  return SPIRIT_ROOTS[SPIRIT_ROOTS.length - 1];
}

/** 按权重抽一个天赋 */
export function rollTalent(rng) {
  const total = TALENTS.reduce((s, t) => s + t.weight, 0);
  let roll = rng.float() * total;
  for (const talent of TALENTS) {
    roll -= talent.weight;
    if (roll <= 0) return talent;
  }
  return TALENTS[TALENTS.length - 1];
}
