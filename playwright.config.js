import { defineConfig } from '@playwright/test';

/**
 * UI 冒烟测试配置（ChatGPT v0.20 决定）
 * - 使用系统已安装的 Chrome（channel: 'chrome'），不下载 Playwright 自带 Chromium
 * - 复用已在运行的本地静态服务器（127.0.0.1:5178），没有时自动启动 npm run dev
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5199',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5199',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

