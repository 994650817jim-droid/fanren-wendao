/**
 * 境界表 —— 单一数值来源，改这里就能调整平衡。
 *
 * 字段说明
 *  - expToNext      本境界修满需要的修为（金丹初期为 null，已是终点）
 *  - perMonth       每「游戏月」闭关获得的基础修为（未乘灵根/天赋）
 *  - rate           突破到下一境界的基础成功率（null = 无下一境界）
 *  - costStones     突破消耗的灵石（阶段一由「凝灵吐纳」产出，阶段二由历练接替）
 *  - hpBonus        突破成功后增加的气血上限
 *  - lifespanBonus  突破成功后增加的寿元（年）
 *
 * 成功率曲线：从凡人到金丹单一递减，大境界处额外多降一点（境界壁垒），
 * 避免出现「越往后越容易」的非单调曲线。
 */
export const REALMS = [
  { id: 0,  name: '凡人',      expToNext: 100,  perMonth: 8,   rate: 1.00, costStones: 0,  hpBonus: 0,   lifespanBonus: 0 },
  { id: 1,  name: '炼气一层',  expToNext: 150,  perMonth: 12,  rate: 0.92, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 2,  name: '炼气二层',  expToNext: 230,  perMonth: 16,  rate: 0.88, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 3,  name: '炼气三层',  expToNext: 340,  perMonth: 22,  rate: 0.84, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 4,  name: '炼气四层',  expToNext: 500,  perMonth: 30,  rate: 0.80, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 5,  name: '炼气五层',  expToNext: 720,  perMonth: 40,  rate: 0.76, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 6,  name: '炼气六层',  expToNext: 1000, perMonth: 52,  rate: 0.72, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 7,  name: '炼气七层',  expToNext: 1400, perMonth: 68,  rate: 0.68, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 8,  name: '炼气八层',  expToNext: 1900, perMonth: 88,  rate: 0.64, costStones: 0,  hpBonus: 10,  lifespanBonus: 10 },
  { id: 9,  name: '炼气九层',  expToNext: 2500, perMonth: 110, rate: 0.58, costStones: 10, hpBonus: 10,  lifespanBonus: 10 },
  { id: 10, name: '筑基初期',  expToNext: 3500, perMonth: 140, rate: 0.54, costStones: 20, hpBonus: 60,  lifespanBonus: 60 },
  { id: 11, name: '筑基中期',  expToNext: 5000, perMonth: 180, rate: 0.50, costStones: 30, hpBonus: 60,  lifespanBonus: 60 },
  { id: 12, name: '筑基后期',  expToNext: 7000, perMonth: 230, rate: 0.45, costStones: 40, hpBonus: 60,  lifespanBonus: 60 },
  { id: 13, name: '金丹初期',  expToNext: null, perMonth: 0,   rate: null, costStones: 0,  hpBonus: 200, lifespanBonus: 200 },
];

export const MAX_REALM_ID = REALMS.length - 1;

export function getRealm(id) {
  const realm = REALMS[id];
  if (!realm) throw new Error(`未知境界 id: ${id}`);
  return realm;
}

export function isFinalRealm(id) {
  return id >= MAX_REALM_ID;
}

/** 0..realmId 累计的寿元加成（年） */
export function totalLifespanBonus(realmId) {
  return REALMS.slice(0, realmId + 1).reduce((sum, r) => sum + r.lifespanBonus, 0);
}

/** 0..realmId 累计的气血上限加成 */
export function totalHpBonus(realmId) {
  return REALMS.slice(0, realmId + 1).reduce((sum, r) => sum + r.hpBonus, 0);
}

/** 全流程需要修炼的总月数（不考虑灵根天赋与失败重试） */
export function totalMonthsToPeak() {
  return REALMS.slice(0, MAX_REALM_ID).reduce((sum, r) => sum + r.expToNext / r.perMonth, 0);
}

/** 全流程突破累计需要多少灵石 */
export function totalStoneCost() {
  return REALMS.reduce((sum, r) => sum + r.costStones, 0);
}
