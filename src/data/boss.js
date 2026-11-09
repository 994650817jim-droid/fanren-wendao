/**
 * 最终 Boss：雷霆麒麟 · 镇坛古灵（金丹期最终试炼）
 *
 * 设计（对应 ChatGPT v0.12 指令）
 *  - 两阶段：血量低于 50% 进入第二阶段，只触发一次
 *  - 雷霆蓄力：每 3 回合蓄力一次，下一回合落下雷霆；玩家可以用「防御」显著减伤
 *  - 复用手上的战斗模块，不单独造 Boss 引擎
 *  - 胜利只结算一次，并写入通关标记
 */
export const BOSS = {
  id: 'thunder-qilin',
  name: '雷霆麒麟 · 镇坛古灵',
  desc: '雷云压境，祭坛上的古灵睁开竖瞳。它的角间缠绕着尚未落下的雷霆。',
  sprite: '/boss-qilin.png',
  minRealm: 13,
  hp: 900,
  atk: 102,
  def: 18,
  rewardStones: 180,
  telegraphEvery: 3,
  phase2At: 0.5,
  phase2AtkScale: 1.3,
  thunderScale: 3.2,
  defendReduction: 0.6,
  defendThunderReduction: 0.75,
};

export function getBoss(id) {
  return BOSS.id === id ? BOSS : null;
}














