import { expect, test } from '@playwright/test';

/**
 * 圖片預覽。
 *
 * 判讀破壞要看細節 —— 縮圖看不出坑洞邊緣是不是真的破損。
 * 所以縮放與鍵盤導覽是主功能，壞了等於這個系統沒辦法審圖。
 */
test.describe('圖片檢視器', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/case');
    await expect(page.getByRole('columnheader', { name: '案件編號' })).toBeVisible({ timeout: 20_000 });
  });

  test('點縮圖開檢視器，可縮放並用鍵盤換圖', async ({ page }) => {
    // 找一列真的有縮圖的：測試造出來的案件沒有照片
    const thumb = page.locator('tbody tr img').first();
    await expect(thumb).toBeVisible({ timeout: 20_000 });
    await thumb.click();

    const viewer = page.getByRole('dialog');
    await expect(viewer.getByText('100%')).toBeVisible({ timeout: 10_000 });

    // 放大：倍率要跟著變，而不是只有圖動
    await viewer.getByRole('button', { name: '放大' }).click();
    await expect(viewer.getByText('140%')).toBeVisible();

    // 重置回到原始倍率
    await viewer.getByRole('button', { name: '重置縮放' }).click();
    await expect(viewer.getByText('100%')).toBeVisible();

    // 一組照片(原始 / AI 判讀)要能左右翻
    await expect(viewer.getByText('1 / 2')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(viewer.getByText('2 / 2')).toBeVisible();

    // Esc 關閉：審圖是連續動作，每次都要移到按鈕上點會很慢
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden({ timeout: 10_000 });
  });

  test('點縮圖不會順便打開那一列的詳情', async ({ page }) => {
    const thumb = page.locator('tbody tr img').first();
    await expect(thumb).toBeVisible({ timeout: 20_000 });
    await thumb.click();

    // 開的是檢視器，不是案件詳情 —— 想看大圖的人不是想打開詳情
    await expect(page.getByRole('dialog').getByText(/滾輪縮放/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('dialog').getByText('地址資訊')).toHaveCount(0);
  });
});

test.describe('派工單照片欄位', () => {
  test('每個照片類型一格，缺件標紅並可上傳', async ({ page }) => {
    await page.goto('/workorder');
    await expect(page.getByText(/共 \d+ 張派工單/)).toBeVisible({ timeout: 20_000 });

    // 用真的 regex 而不是 text= 選擇器字串：後者的跳脫規則與 JS 不同，
    // \d 會被當成字面的 d
    await page.getByText(/[A-Z0-9]+P[A-D]\d{8}/).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: /施工照片/ }).click();

    // 一格對應一個階段：缺哪一格一眼看得出來
    await expect(dialog.getByText('施工前').first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('施工後').first()).toBeVisible();
    await expect(dialog.getByText(/單檔上限 20MB|KB）/).first()).toBeVisible();
  });
});
