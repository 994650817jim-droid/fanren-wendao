/**
 * 背包与疗伤丹（对应 ChatGPT v0.15 指令）
 *
 * 规则（第一版试验值）：
 *  - 灵石仍是唯一货币；疗伤丹是真实库存，不再是 floor(灵石/8) 的假库存
 *  - 洞府商店 8 灵石/枚，购买必须原子结算（钱不够就整笔失败）
 *  - 战斗中服药消耗一枚真实库存，回血 30% 最大气血
 *  - 单场战斗最多服 2 枚（可囤积，但每场有限）
 */

export const PILL_ID = 'healingPill';
export const PILL_NAME = '疗伤丹';
export const PILL_PRICE = 8;
export const PILL_HEAL_RATIO = 0.3;
export const PILL_MAX_PER_BATTLE = 2;

export function emptyInventory() {
  return { [PILL_ID]: 0 };
}

export function normalizeInventory(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pill = Number(source[PILL_ID]);
  return { [PILL_ID]: Number.isFinite(pill) && pill > 0 ? Math.floor(pill) : 0 };
}

export function pillCount(character) {
  return normalizeInventory(character && character.inventory)[PILL_ID];
}

/**
 * 购买疗伤丹（原子）：灵石不足则整笔失败，不扣钱不加货。
 * @returns {{ok:boolean, reason?:string, spent?:number, bought?:number}}
 */
export function buyPills(character, count = 1) {
  const amount = Math.floor(Number(count));
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: '购买数量非法' };
  if (amount > 99) return { ok: false, reason: '一次最多购买 99 枚' };
  const cost = amount * PILL_PRICE;
  if (character.stones < cost) {
    return { ok: false, reason: `灵石不足，${amount} 枚${PILL_NAME}需要 ${cost} 枚灵石` };
  }
  character.stones -= cost;
  character.inventory = normalizeInventory(character.inventory);
  character.inventory[PILL_ID] += amount;
  return { ok: true, spent: cost, bought: amount };
}

/** 战斗中能否服丹：库存 > 0 且未超过单场上限 */
export function canUsePill(character, pillsUsedThisBattle = 0) {
  if (pillCount(character) <= 0) return { ok: false, reason: `${PILL_NAME}不足` };
  if (pillsUsedThisBattle >= PILL_MAX_PER_BATTLE) {
    return { ok: false, reason: `此战已服 ${PILL_MAX_PER_BATTLE} 枚${PILL_NAME}，不可再服` };
  }
  return { ok: true };
}

/** 消耗一枚疗伤丹，返回是否成功 */
export function consumePill(character) {
  character.inventory = normalizeInventory(character.inventory);
  if (character.inventory[PILL_ID] <= 0) return false;
  character.inventory[PILL_ID] -= 1;
  return true;
}
