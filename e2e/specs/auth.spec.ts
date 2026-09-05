import { expect, test } from '@playwright/test';

test.describe('登入與權限', () => {
  // 這一組要驗「沒登入的行為」，所以不吃共用憑證
  test.use({ storageState: { cookies: [], origins: [] } });

  test('未登入時導向登入頁', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
  });

  test('密碼錯誤時顯示訊息且不透露帳號是否存在', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('公司代號').fill('DEMO');
    await page.getByLabel('帳號').fill('admin');
    await page.getByLabel('密碼').fill('WrongPass123');
    await page.getByRole('button', { name: '登入' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    // 訊息不能說「查無此帳號」——那等於幫攻擊者篩出有效帳號
    await expect(alert).not.toContainText('不存在');
  });
});

test.describe('權限過濾', () => {
  test('檢視者看不到需要寫入權限的功能', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto('/login');
    await page.getByLabel('公司代號').fill('DEMO');
    await page.getByLabel('帳號').fill('viewer');
    await page.getByLabel('密碼').fill('Demo1234');
    await page.getByRole('button', { name: '登入' }).click();

    await expect(page.getByRole('button', { name: '登出' })).toBeVisible();

    // 檢視者沒有帳號管理權限，系統管理不該出現在側邊欄
    await expect(page.getByRole('link', { name: '系統管理' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '案件管理' })).toBeVisible();

    await context.close();
  });
});

/**
 * 憑證過期。
 *
 * 這是最容易被漏掉的路徑：開發時 token 還沒過期，測試環境也不會等 30 分鐘。
 * 結果就是使用者停在一個看起來正常、但每個操作都失敗的畫面上。
 */
test.describe('憑證過期', () => {
  test('token 失效時自動踢回登入頁並說明原因', async ({ page, context }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible();

    // 模擬 token 過期：清掉 cookie，下一次 API 呼叫就會是 401
    await context.clearCookies();

    // 觸發一次 API 呼叫。用直接導航而不是點側邊欄 ——
    // cookie 清掉後導覽本身也會失敗，那個連結可能已經不在了
    await page.goto('/case');

    // 應該自己回登入頁，而且告訴使用者為什麼
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('登入已過期，請重新登入')).toBeVisible();
  });
});
