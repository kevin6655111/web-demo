import { expect, test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = 'specs/.auth/user.json';

/**
 * 登入一次，把 cookie 存起來給其他測試重用。
 *
 * 每支測試各自登入的話：測試會慢、而且連續失敗 5 次就會觸發帳號鎖定 ——
 * 那是系統該有的行為，但會讓整批測試在第六支開始全紅。
 */
setup('登入並保存憑證', async ({ page }) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  await page.goto('/login');

  await page.getByLabel('公司代號').fill('DEMO');
  await page.getByLabel('帳號').fill('admin');
  await page.getByLabel('密碼').fill('Demo1234');
  await page.getByRole('button', { name: '登入' }).click();

  // 登入成功的判準是「側邊欄出現」而不是網址變了：
  // 網址在導覽載入前就會變，那時畫面還是空的
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
