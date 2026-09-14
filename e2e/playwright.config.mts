import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端測試設定。
 *
 * 這一層測的是「整條路徑會不會通」——登入、查詢、地圖渲染、即時推播 ——
 * 前面兩層(Presenter 單元測試、後端 E2E)都測不到瀏覽器裡真的發生了什麼。
 *
 * 刻意不啟動服務(webServer 留空)：這個 Demo 有六個行程，
 * 由 Playwright 逐一拉起來只會讓失敗訊息變得難以判讀。
 * 服務由 `yarn start` 或 compose 先跑起來，測試只負責驗。
 */
export default defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // 本機平行跑會讓即時推播的測試互相干擾(同一個帳號的 WebSocket 連線)
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }]]
    : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
    // 只在失敗時留下證據：全部都留會讓 CI 的產出物爆掉
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei'
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'specs/.auth/user.json' },
      dependencies: ['setup']
    }
  ],

  outputDir: 'results/artifacts'
});
