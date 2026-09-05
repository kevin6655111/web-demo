import { expect, test } from '@playwright/test';

/**
 * 地圖是這個系統最容易「看起來沒壞但其實空的」的地方：
 * 圖層抓失敗、座標順序顛倒、圖磚被擋掉，畫面上都只是一片深藍。
 * 所以這裡驗的是「真的有東西畫出來」而不只是頁面有載入。
 */
test.describe('圖台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/map');
    await expect(page.getByRole('tab', { name: '破壞查詢' })).toBeVisible({ timeout: 20_000 });
  });

  test('破壞查詢畫出案件並顯示統計', async ({ page }) => {
    await page.getByRole('tab', { name: '破壞查詢' }).click();

    // Leaflet 用 canvas 繪製，所以驗容器與圖磚而不是個別點位
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 25_000 });

    // 側邊統計有數字，代表圖層資料真的回來了
    await expect(page.getByText('案件統計')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/顯示 \d+ \/ 共 \d+ 筆/)).toBeVisible({ timeout: 15_000 });
  });

  test('破壞查詢的三種渲染模式都能切換', async ({ page }) => {
    await page.getByRole('tab', { name: '破壞查詢' }).click();
    await expect(page.getByText(/顯示 \d+ \/ 共 \d+ 筆/)).toBeVisible({ timeout: 20_000 });

    // 圖層控制在左欄，三種模式對應三種資料量下的看法
    for (const mode of ['案件', '聚合', '熱點']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.locator('.leaflet-container')).toBeVisible();
    }
  });

  test('圖層可以同時開多個並疊看', async ({ page }) => {
    // 先載入破壞案件
    await page.getByRole('tab', { name: '破壞查詢' }).click();
    await expect(page.getByText(/顯示 \d+ \/ 共 \d+ 筆/)).toBeVisible({ timeout: 20_000 });

    // 等圖層真的登錄到控制面板再切走 ——
    // 統計數字是面板自己的狀態，圖層登錄是之後才發生的效果。
    // 不等的話，切走的時機可能落在兩者之間，而使用者本來也是看到圖層出現才換頁
    await expect(page.getByText(/破壞案件\s*\d+/).first()).toBeVisible({ timeout: 20_000 });

    // 再載入道路評估 —— 兩個圖層應該都留在控制面板上
    await page.getByRole('tab', { name: '道路評估' }).click();
    await expect(page.getByText('養護等級分布')).toBeVisible({ timeout: 20_000 });

    // 這是重點：切換功能不會把上一個圖層清掉。
    // 用圖例來驗 —— 它只在「同時有兩個以上可見圖層」時才出現，
    // 正好就是這個測試要證明的事
    const legend = page.locator('.leaflet-container').locator('..').getByText(/破壞案件\s*\d+/);
    await expect(legend).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/路段評估\s*\d+/)).toBeVisible({ timeout: 15_000 });
  });

  test('底圖切換：預設是臺灣電子地圖', async ({ page }) => {
    await page.getByRole('button', { name: '底圖' }).click();

    // NLSC 電子地圖：台灣的路名與門牌比 OSM 完整，且免金鑰
    await expect(page.getByRole('button', { name: '臺灣電子地圖' })).toBeVisible();

    await page.getByRole('button', { name: '正射影像' }).click();
    await page.keyboard.press('Escape');

    await expect(page.locator('.leaflet-container')).toBeVisible();
  });

  test('車隊管理顯示車輛與線上狀態', async ({ page }) => {
    await page.getByRole('tab', { name: '車隊管理' }).click();

    await expect(page.getByText(/車隊 \d+ 台/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/在線 \d+ 台/)).toBeVisible();
    // 車牌直接標在地圖上，調度時不必點開才知道是哪台
    await expect(page.locator('.leaflet-tooltip').first()).toBeVisible({ timeout: 20_000 });
  });

  test('軌跡查詢能查出里程與回放', async ({ page }) => {
    await page.getByRole('tab', { name: '軌跡查詢' }).click();
    await expect(page.getByText('行程摘要')).toBeVisible({ timeout: 15_000 });

    // 車輛清單是非同步載入的；等它有值再查，否則查的是「還沒選車」的狀態。
    // 使用者本來就會等下拉出現才按查詢
    await expect(page.getByRole('combobox', { name: /車輛/ })).toContainText(/DEMO-/, { timeout: 15_000 });

    // 示範軌跡涵蓋近五天，把起始日往前推才查得到
    const start = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel('起始日').fill(start);
    await page.getByRole('button', { name: '查詢' }).click();

    await expect(page.getByText('里程')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('回放')).toBeVisible({ timeout: 20_000 });
  });

  test('還沒選車就查詢會說明原因，而不是靜靜沒反應', async ({ page }) => {
    await page.getByRole('tab', { name: '軌跡查詢' }).click();
    await expect(page.getByText('行程摘要')).toBeVisible({ timeout: 15_000 });

    // 清空車輛後查詢：「點了沒反應」是最難從日誌查出來的問題 ——
    // API 沒被呼叫，所以後端什麼都不知道
    await page.getByRole('button', { name: '清除' }).click();
    await page.getByRole('button', { name: '查詢' }).click();

    await expect(page.getByText('請先選擇車輛')).toBeVisible({ timeout: 10_000 });
  });

  test('道路評估顯示養護等級分布', async ({ page }) => {
    await page.getByRole('tab', { name: '道路評估' }).click();

    await expect(page.getByText('養護等級分布')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('需維修比例')).toBeVisible();
    await expect(page.getByText('良好').first()).toBeVisible();
  });

  test('圖資查詢把所有圖層一次載入', async ({ page }) => {
    await page.getByRole('tab', { name: '圖資查詢' }).click();

    await expect(page.getByText('圖資總覽')).toBeVisible({ timeout: 20_000 });

    // 四個圖層一次備齊(案件、路段、計畫、調查點)，過濾交給圖層控制
    await expect
      .poll(async () => page.locator('.MuiSwitch-input').count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(4);
  });
});
