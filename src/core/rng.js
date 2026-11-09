/**
 * 确定性随机数工具。
 * 所有随机都通过 makeRng(seed) 注入，测试时可以固定 seed 得到可复现结果。
 */

/** mulberry32：32 位种子伪随机，跨平台一致 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把无种子随机包装成与 mulberry32 相同接口 */
export function createRng(seed = Date.now()) {
  const f = mulberry32(seed);
  f.seed = seed >>> 0;
  f.float = () => f();
  f.range = (min, max) => min + (max - min) * f();
  f.int = (min, max) => Math.floor(min + (max - min + 1) * f());
  f.chance = (p) => f() < p;
  f.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(f() * arr.length))];
  return f;
}

/** 单例随机源（游戏运行时使用），测试里可替换 */
let current = createRng();

export function getRng() {
  return current;
}

export function setRng(rng) {
  current = rng;
}

export function reseed(seed = Date.now()) {
  current = createRng(seed);
  return current;
}

