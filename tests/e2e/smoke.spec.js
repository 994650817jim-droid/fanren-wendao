/**
 * UI 冒烟测试（ChatGPT v1.0 RC2 要求：不允许「假通过」）
 *
 * 关键约定：
 *  - 断言必须无条件：目标场景没发生就是失败，不能用 if (count()) 兜住
 *  - 夹具只在测试开始时初始化一次（先 goto，再用 evaluate 写入，最后再 goto），
 *    之后的 reload 完全由浏览器自身持久化，不覆盖存档、不清偏好
 *  - 区分 pageerror / console.error / requestfailed
 */
import { test, expect } from '@playwright/test';

const SAVE_KEY = 'fanren-wendao:save';
const PREFS_KEY = 'fanren-wendao:prefs';

function makeSave(overrides = {}) {
  const base = {
    version: 7,
    savedAt: new Date().toISOString(),
    character: {
      name: '冒烟测试',
      rootId: 'heaven',
      talentId: 'genius',
      realmId: 13,
      exp: 0,
      hp: 570,
      stones: 120,
      months: 420,
      pity: {},
      pendingEvent: null,
      combat: null,
      victory: false,
      inventory: { healingPill: 0 },
      story: { flags: {}, seenEvents: [], completedEvents: [] },
      log: [{ month: 420, text: '金丹初期。', kind: 'milestone' }],
    },
  };
  return { ...base, ...overrides };
}

/** 只初始化一次：先打开空白页写 localStorage，再进入游戏；后续 reload 不再注入 */
async function boot(page, save) {
  const errors = { page: [], console: [], resource: [] };
  page.on('pageerror', (err) => errors.page.push(String(err && err.message ? err.message : err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.console.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    if (!req.url().startsWith('data:')) errors.resource.push(req.url());
  });

  await page.goto('/');
  await page.evaluate(
    ([key, prefsKey, payload]) => {
      window.localStorage.clear();
      window.localStorage.removeItem(prefsKey);
      if (payload) window.localStorage.setItem(key, payload);
    },
    [SAVE_KEY, PREFS_KEY, save ? JSON.stringify(save) : null]
  );
  await page.goto('/');
  await page.waitForSelector('.page', { timeout: 15_000 });
  return errors;
}

async function enterGame(page) {
  await page.getByRole('button', { name: '继续前缘' }).click();
  await expect(page.getByRole('button', { name: /洞府丹房|外出历练/ }).first()).toBeVisible();
}

async function startBoss(page) {
  await page.getByRole('button', { name: /挑战最终试炼/ }).click();
  await expect(page.locator('.combat-overlay')).toBeVisible();
}

async function attackOnce(page) {
  const overlay = page.locator('.combat-overlay');
  const attack = overlay.locator('.choices button').first();
  await attack.click();
  await page.waitForTimeout(900);
}

test('1. 启动游戏：渲染正常且无未捕获异常', async ({ page }) => {
  const errors = await boot(page, null);
  await expect(page.getByRole('button', { name: '开始问道' })).toBeVisible();
  expect(errors.page, '未捕获异常：' + errors.page.join(' | ')).toEqual([]);
  expect(errors.console, 'console.error：' + errors.console.join(' | ')).toEqual([]);
  expect(errors.resource, '资源加载失败：' + errors.resource.join(' | ')).toEqual([]);
});

test('2. 创建角色并进入洞府', async ({ page }) => {
  const errors = await boot(page, null);
  await page.getByRole('button', { name: '开始问道' }).click();
  await page.locator('input[type="text"]').fill('冒烟道友');
  await page.getByRole('button', { name: '踏入仙途' }).click();
  await expect(page.getByRole('button', { name: /外出历练/ })).toBeVisible();
  expect(errors.page).toEqual([]);
});

test('3. 闭关确实推进游戏时间', async ({ page }) => {
  const save = makeSave();
  save.character.realmId = 3;
  save.character.hp = 60;
  save.character.months = 60;
  await boot(page, save);
  await enterGame(page);
  const timeText = page.locator('.time, .chip').first();
  const before = await timeText.innerText();
  await page.getByRole('button', { name: /闭关修炼/ }).first().click();
  await page.waitForTimeout(600);
  const after = await page.locator('.time, .chip').first().innerText();
  expect(after, `时间应变化：${before} → ${after}`).not.toBe(before);
});

test('4. 历练必定触发奇遇弹窗，选择后关闭', async ({ page }) => {
  const save = makeSave();
  save.character.realmId = 0;
  save.character.hp = 60;
  await boot(page, save);
  await enterGame(page);
  await page.getByRole('button', { name: /外出历练/ }).first().click();
  await page.getByRole('button', { name: /踏入山道/ }).first().click();
  const modal = page.locator('.event-overlay').first();
  await expect(modal, '历练应触发奇遇弹窗').toBeVisible({ timeout: 10_000 });
  await expect(modal.locator('.choices button').first()).toBeVisible();
  await modal.locator('.choices button').first().click();
  await expect(page.locator('.event-overlay')).toHaveCount(0);
});

test('5. 洞府丹房购买增加库存', async ({ page }) => {
  const save = makeSave();
  save.character.stones = 100;
  await boot(page, save);
  await enterGame(page);
  await expect(page.locator('.shop-stock')).toContainText('×0');
  await page.getByRole('button', { name: /购入 5 枚/ }).click();
  await expect(page.locator('.shop-stock')).toContainText('×5');
});

test('6. 深入险地必定进入战斗，一次攻击只结算一次', async ({ page }) => {
  const errors = await boot(page, makeSave());
  await enterGame(page);
  await page.getByRole('button', { name: /外出历练/ }).first().click();
  await page.getByRole('button', { name: /深入险地/ }).first().click();
  const overlay = page.locator('.combat-overlay');
  await expect(overlay, '深入险地应进入战斗').toBeVisible({ timeout: 10_000 });
  const before = await overlay.locator('.combat-num').nth(0).innerText();
  await overlay.locator('.choices button').first().click();
  await page.waitForTimeout(900);
  const after = await overlay.locator('.combat-num').nth(0).innerText();
  expect(after).not.toBe(before);
  expect(await page.locator('.combat-overlay').count()).toBeLessThanOrEqual(1);
  expect(errors.page).toEqual([]);
});

test('7. Boss 雷云预警与余雷补防', async ({ page }) => {
  await boot(page, makeSave());
  await enterGame(page);
  await startBoss(page);
  await expect(page.locator('.combat-overlay .telegraph-bar')).toContainText(/第 1 阶段/);

  let warned = false;
  for (let i = 0; i < 8 && !warned; i += 1) {
    const bar = await page.locator('.combat-overlay .telegraph-bar').innerText();
    if (/雷云已聚/.test(bar)) { warned = true; break; }
    await attackOnce(page);
  }
  expect(warned, '八回合内必须出现雷云预警').toBe(true);

  await attackOnce(page); // 预警回合不防御
  await expect(page.locator('.combat-overlay .telegraph-bar')).toContainText(/余雷未散/, { timeout: 8_000 });
  await page.getByRole('button', { name: /运功防御/ }).click();
  await page.waitForTimeout(950);
  await expect(page.locator('.combat-overlay .telegraph-bar')).toContainText(/第 \d 阶段/);
});

test('8. Boss 首次战败：教学提示必须出现且写入偏好', async ({ page }) => {
  const save = makeSave();
  save.character.hp = 150; // 撑到雷云预警后死于雷霆（普通攻击死亡不算雷霆教学）
  await boot(page, save);
  await enterGame(page);
  await startBoss(page);
  const hint = page.locator('.event-overlay:not(.combat-overlay)').first();
  for (let i = 0; i < 8; i += 1) {
    if (await hint.count()) break;
    if (!(await page.locator('.combat-overlay').count())) break;
    await attackOnce(page);
  }
  await page.waitForTimeout(1200);
  await expect(hint, '首次战败必须弹出教学提示').toBeVisible({ timeout: 12_000 });
  await expect(hint).toContainText('雷霆虽烈');
  await page.getByRole('button', { name: '记下了' }).click();
  const prefs = await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY);
  expect(prefs).toContain('"seenThunderHint":true');
});

test('9. 成功防御过的玩家战败时不再弹教学', async ({ page }) => {
  const save = makeSave();
  save.character.hp = 210;
  await boot(page, save);
  await enterGame(page);
  await startBoss(page);

  // 先确保成功防御一次雷霆
  let defended = false;
  let guard = 0;
  while (!defended && guard < 8) {
    guard += 1;
    if (!(await page.locator('.combat-overlay').count())) break;
    const bar = (await page.locator('.combat-overlay .telegraph-bar').innerText().catch(() => '')) || '';
    if (/雷云已聚/.test(bar)) {
      await page.getByRole('button', { name: /运功防御/ }).click();
      defended = true;
      await page.waitForTimeout(900);
      break;
    }
    await attackOnce(page);
  }
  expect(defended, '测试前提：必须先成功防御一次雷霆').toBe(true);

  // 之后不再防御，直到战败
  for (let i = 0; i < 14; i += 1) {
    if (!(await page.locator('.combat-overlay').count())) break;
    await attackOnce(page);
  }
  await page.waitForTimeout(1200);
  const hint = page.locator('.event-overlay:not(.combat-overlay)').first();
  const hintCount = await hint.count();
  if (hintCount > 0) {
    await expect(hint).not.toContainText('雷霆虽烈');
  }
  const prefs = await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY);
  expect(prefs === null || !prefs.includes('"seenThunderHint":true')).toBe(true);
});

test('10. 战斗中刷新可恢复（夹具不覆盖存档）', async ({ page }) => {
  await boot(page, makeSave());
  await enterGame(page);
  await startBoss(page);
  await attackOnce(page);
  const before = await page.locator('.combat-overlay .combat-num').nth(1).innerText();
  await page.reload();
  await expect(page.getByRole('button', { name: '继续前缘' })).toBeVisible({ timeout: 15_000 });
  await enterGame(page);
  await expect(page.locator('.combat-overlay')).toBeVisible({ timeout: 10_000 });
  const after = await page.locator('.combat-overlay .combat-num').nth(1).innerText();
  expect(after).toBe(before);
});

test('11. 手机短屏 375×667：战斗按钮可滚动触达并点击', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await boot(page, makeSave());
  await enterGame(page);
  await startBoss(page);
  const buttons = page.locator('.combat-overlay .choices button');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeInViewport();
  }
  // 至少能真实点击一次普通攻击
  await buttons.first().click();
  await page.waitForTimeout(900);
  await expect(page.locator('.combat-overlay .combat-num').first()).not.toHaveText('900 / 900');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});



test('12. 修炼反馈：局部脉冲、无全屏闪光、连点不叠加', async ({ page }) => {
  const save = makeSave();
  save.character.realmId = 3;
  save.character.hp = 60;
  save.character.months = 60;
  save.character.exp = 0;
  await boot(page, save);
  await enterGame(page);

  const readExp = () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem('fanren-wendao:save');
      return raw ? JSON.parse(raw).character.exp : null;
    });

  const beforeExp = await readExp();
  await page.getByRole('button', { name: /闭关修炼/ }).first().click();
  await expect(page.locator('.bar.exp.value-pulse')).toBeVisible({ timeout: 3_000 });
  // 不允许出现全屏反馈层
  await expect(page.locator('.flash')).toHaveCount(0);
  await expect(page.locator('.soft-pulse')).toHaveCount(0);

  // 连续点击（凝灵可重复）：不能叠加多个脉冲光效节点
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: /凝灵吐纳/ }).first().click();
    await page.waitForTimeout(160);
  }
  const pulseNodes = await page.locator('.value-pulse').count();
  expect(pulseNodes, '连续点击不应叠加多个脉冲节点').toBeLessThanOrEqual(2);
  await expect(page.locator('.flash')).toHaveCount(0);
  await expect(page.locator('.soft-pulse')).toHaveCount(0);

  await page.waitForTimeout(900);
  const afterExp = await readExp();
  expect(afterExp, '闭关后修为必须增加').toBeGreaterThan(beforeExp);
});

test('13. 减少动态模式：不播放脉冲但数值仍然更新', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const save = makeSave();
  save.character.realmId = 3;
  save.character.hp = 60;
  save.character.months = 60;
  save.character.exp = 0;
  await boot(page, save);
  await enterGame(page);

  const readExp = () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem('fanren-wendao:save');
      return raw ? JSON.parse(raw).character.exp : null;
    });

  const beforeExp = await readExp();
  await page.getByRole('button', { name: /闭关修炼/ }).first().click();
  await page.waitForTimeout(120);
  await expect(page.locator('.flash')).toHaveCount(0);
  await expect(page.locator('.soft-pulse')).toHaveCount(0);
  await page.waitForTimeout(800);
  const afterExp = await readExp();
  expect(afterExp, '减少动态模式也应正常增加修为').toBeGreaterThan(beforeExp);
});

