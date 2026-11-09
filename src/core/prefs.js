/**
 * 本地偏好设置（与存档解耦，不参与游戏状态）。
 * 目前只有战斗动画速度：fast / full / reduced
 */
export const PREFS_KEY = 'fanren-wendao:prefs';
export const SPEED_OPTIONS = ['fast', 'full', 'reduced'];

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  } catch {
    return false;
  }
}

/** 默认：系统要求减少动画 → reduced；否则 fast */
export function defaultSpeed() {
  return prefersReducedMotion() ? 'reduced' : 'fast';
}

export function loadPrefs(store = storage()) {
  const fallback = { animationSpeed: defaultSpeed(), seenThunderHint: false };
  if (!store) return fallback;
  try {
    const raw = store.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const speed = SPEED_OPTIONS.includes(parsed.animationSpeed) ? parsed.animationSpeed : fallback.animationSpeed;
    return { animationSpeed: speed, seenThunderHint: parsed.seenThunderHint === true };
  } catch {
    return fallback;
  }
}

export function savePrefs(patch, store = storage()) {
  const next = { ...loadPrefs(store), ...patch };
  if (!store) return next;
  try {
    store.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* 忽略写入失败：偏好不是关键状态 */
  }
  return next;
}

/** 首次战败的雷霆提示：只在玩家从未在预警回合防御时展示一次 */
export function shouldShowThunderHint(store = storage()) {
  return loadPrefs(store).seenThunderHint !== true;
}

export function markThunderHintShown(store = storage()) {
  savePrefs({ seenThunderHint: true }, store);
  return true;
}

export function setAnimationSpeed(speed, store = storage()) {
  const valid = SPEED_OPTIONS.includes(speed) ? speed : defaultSpeed();
  savePrefs({ animationSpeed: valid }, store);
  return valid;
}
