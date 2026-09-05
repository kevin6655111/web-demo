import { expect, test } from '@playwright/test';

/**
 * 導覽是後端資料驅動的，所以這裡驗的其實是「後端定義有正確長成前端的選單」——
 * 側邊欄少一個項目時，是後端定義、權限過濾、或前端對照表其中之一壞了。
 */
test.describe('導覽', () => {
  test('管理員看得到全部六個模組', async ({ page }) => {
    await page.goto('/dashboard');

    for (const name of ['儀表板', '圖台管理', '案件管理', '派工管理', '報表管理', '系統管理']) {
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
  });

  test('每個模組都能開啟且不出現錯誤', async ({ page }) => {
    await page.goto('/dashboard');

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const [name, heading] of [
      ['儀表板', '今日新增'],
      // 用分頁標籤而不是「來源」：後者也是查詢面板裡「案件來源」的前綴，
      // 而那個欄位收在進階條件裡，預設是隱藏的
      ['案件管理', 'AI 車巡'],
      // 派工管理預設進巡查單分頁：流程是先發現、再派工
      ['派工管理', '張巡查單'],
      ['報表管理', '產製報表'],
      ['系統管理', '標案']
    ]) {
      await page.getByRole('link', { name }).click();
      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 15_000 });
    }

    expect(errors, `頁面發生 JS 錯誤：\n${errors.join('\n')}`).toHaveLength(0);
  });
});
