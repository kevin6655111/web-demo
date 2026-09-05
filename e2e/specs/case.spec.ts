import { expect, test } from '@playwright/test';

test.describe('案件管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/case');
    await expect(page.getByRole('columnheader', { name: '案件編號' })).toBeVisible();
  });

  test('查詢條件會縮小結果並顯示已套用的條件', async ({ page }) => {
    // 等資料真的進來再數：查詢前是 0 的話，這個測試等於在驗「0 <= 0」
    await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const rowsBefore = await page.locator('tbody tr').count();

    // MUI 的多選 Select 渲染成 div[role=combobox]，用它在表單裡的位置定位
    await page.locator('[role="combobox"]').first().click();
    await page.getByRole('option', { name: '已派工' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查詢' }).click();

    // 已套用的條件要看得到：收合後看不見的條件最容易變成「為什麼查不到」的客訴
    await expect(page.getByText('案件狀態：已派工')).toBeVisible();

    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 10_000 })
      .toBeLessThanOrEqual(rowsBefore);
  });

  test('來源分頁切換', async ({ page }) => {
    await page.getByRole('tab', { name: 'AI 車巡' }).click();
    await expect(page.getByRole('tab', { name: 'AI 車巡' })).toHaveAttribute('aria-selected', 'true');

    // 切分頁後表格仍要有資料(或明確顯示查無)，不能是永遠轉圈
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 });
  });

  test('歷程對話框能看時間軸與欄位表，並比較版本', async ({ page }) => {
    await page.getByRole('button', { name: '版本' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/共 \d+ 個版本/)).toBeVisible();

    // 切到欄位表：兩種看法對應兩種問題(發生了什麼 vs 哪個欄位被改)
    await dialog.getByRole('button', { name: '欄位表' }).click();
    await expect(dialog.getByRole('table')).toBeVisible();

    await dialog.getByRole('button', { name: '時間軸' }).click();

    // 勾兩個版本比較
    const chips = dialog.locator('.MuiChip-root', { hasText: /^v\d+$/ });
    if ((await chips.count()) >= 2) {
      await chips.nth(0).click();
      await chips.nth(1).click();
      await expect(dialog.getByText(/v\d+ → v\d+/)).toBeVisible({ timeout: 10_000 });
    }
  });
});
