/**
 * 敌人数据（阶段二第一批）。
 * 数值随境界缩放：enemy.atk / def / hp 会乘以境界系数，避免低境界被秒杀。
 */
export const ENEMIES = [
  {
    id: 'iron-wolf',
    sprite: '/enemy-wolf.png',
    name: '铁背狼',
    desc: '背脊如铁的黑狼，眼睛在雾里泛着幽光。',
    minRealm: 0,
    tier: 'normal',
    weight: 10,
    hp: 60,
    atk: 12,
    def: 4,
    rewardStones: 10,
    rewardExpRatio: 0.18,
  },
  {
    id: 'red-cat',
    sprite: '/enemy-fox.png',
    name: '赤霞山猫',
    desc: '毛色赤红，动作极快，尾尖带着一丝火星。',
    minRealm: 2,
    tier: 'normal',
    weight: 9,
    hp: 120,
    atk: 20,
    def: 8,
    rewardStones: 18,
    rewardExpRatio: 0.22,
  },
  {
    id: 'rogue-spirit',
    sprite: '/enemy-ape.png',
    name: '游魂散修',
    desc: '不知死了多少年的散修，只剩执念在乱葬岗游荡。',
    minRealm: 5,
    tier: 'elite',
    weight: 8,
    hp: 125,
    atk: 24,
    def: 12,
    rewardStones: 30,
    rewardExpRatio: 0.28,
  },
];

export function getEnemy(id) {
  return ENEMIES.find((enemy) => enemy.id === id) || null;
}

/** 按境界权重抽一个敌人 */
export function pickEnemy(character, rng) {
  const pool = ENEMIES.filter((enemy) => character.realmId >= enemy.minRealm);
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, enemy) => sum + enemy.weight, 0);
  let roll = rng.float() * total;
  for (const enemy of pool) {
    roll -= enemy.weight;
    if (roll <= 0) return enemy;
  }
  return pool[pool.length - 1];
}





