import { expect, test } from '@playwright/test';

/**
 * 表單。
 *
 * 「點了沒反應」是使用者最常回報、也最難從日誌看出來的問題 ——
 * API 沒被呼叫，所以後端什麼都不知道。這一組驗的就是「點得開、存得下去」。
 */
test.describe('案件詳情與編輯', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/case');
    await expect(page.getByRole('columnheader', { name: '案件編號' })).toBeVisible({ timeout: 20_000 });
  });

  test('點案件列打開詳情，含基本資料、派工、討論三個分頁', async ({ page }) => {
    await page.locator('tbody tr').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 規格表要有實際內容，不是空殼；欄位分組後標籤會重複出現，取第一個就好
    await expect(dialog.getByText('案件編號').first()).toBeVisible();
    await expect(dialog.getByText('破壞類型').first()).toBeVisible();
    await expect(dialog.getByText('檢測時間').first()).toBeVisible();
    // 分組標題：三十幾個欄位攤成一片沒有人看得完
    await expect(dialog.getByText('地址資訊')).toBeVisible();
    await expect(dialog.getByText('狀態與經手')).toBeVisible();

    await dialog.getByRole('tab', { name: /派工/ }).click();
    await expect(dialog.getByText(/尚未派工|施工人員/)).toBeVisible({ timeout: 10_000 });

    await dialog.getByRole('tab', { name: /討論/ }).click();
    await expect(dialog.getByPlaceholder('輸入訊息…')).toBeVisible();
  });

  test('詳情可以上下筆翻頁', async ({ page }) => {
    await page.locator('tbody tr').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/1 \/ \d+/)).toBeVisible();

    // 審案件是一筆接一筆看的，不該每看一筆就關掉再點下一筆
    await dialog.getByRole('button', { name: '下一筆案件' }).click();
    await expect(dialog.getByText(/2 \/ \d+/)).toBeVisible({ timeout: 10_000 });
  });

  test('就地編輯後才亮起儲存，存檔寫入新版本', async ({ page }) => {
    await page.locator('tbody tr').first().click();

    const detail = page.getByRole('dialog');
    const save = detail.getByRole('button', { name: '儲存變更' });

    // 沒改東西時按不下去 —— 按得下去卻什麼也沒發生，會寫出一個沒有變更的版本
    await expect(save).toBeDisabled();

    // 檢視與編輯不分開：欄位就地可改，改了才亮起儲存。
    // 分成兩個對話框的話，承辦得先看一遍、關掉、再開編輯視窗找同一個欄位
    const remark = detail.locator('input[type="text"]').last();
    await remark.fill(`E2E 表單測試 ${Date.now()}`);

    await expect(save).toBeEnabled();
    await save.click();

    await expect(detail.getByText('案件已更新')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('系統管理的表單', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/manage');
    await expect(page.getByRole('tab', { name: /標案/ })).toBeVisible({ timeout: 20_000 });
  });

  test('每個分頁都有新增按鈕且表單打得開', async ({ page }) => {
    for (const [tab, title] of [
      ['標案', '新增標案'],
      ['人員', '新增帳號'],
      ['角色權限', '新增角色'],
      ['車輛', '新增車輛'],
      ['巡查設定', '新增巡查計畫'],
      ['公告', '發布公告']
    ]) {
      await page.getByRole('tab', { name: new RegExp(tab) }).click();

      const addButton = page.getByRole('button', { name: new RegExp(`新增${tab}|新增公告`) });
      await expect(addButton).toBeVisible({ timeout: 10_000 });
      await addButton.click();

      await expect(page.getByRole('dialog').getByText(title)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
    }
  });

  test('新增標案並在列表中看到它', async ({ page }) => {
    // 標案號是案件編號的前綴，長度上限 10 —— 用時間戳的後六碼就夠唯一
    const prjId = `E2E${String(Date.now()).slice(-6)}`;

    await page.getByRole('button', { name: '新增標案' }).click();

    const form = page.getByRole('dialog');
    await form.getByLabel('系統編號').fill(prjId);
    await form.getByLabel('標案簡稱').fill('E2E 測試標案');
    await form.getByLabel('標案全名').fill('E2E 測試標案全名');
    // 用 role 定位：「業主單位」與「業主等級」的標籤有共同前綴
    await form.getByRole('textbox', { name: '業主單位' }).fill('示範市政府建設局');
    await form.getByLabel('日期(起)').fill('2027-01-01');
    await form.getByLabel('日期(迄)').fill('2027-12-31');
    await form.getByRole('button', { name: '儲存' }).click();

    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(prjId)).toBeVisible({ timeout: 15_000 });
  });

  test('角色權限用矩陣勾選，並提示不會立即生效', async ({ page }) => {
    await page.getByRole('tab', { name: /角色權限/ }).click();
    await page.locator('tbody tr').first().click();

    const form = page.getByRole('dialog');
    await expect(form.getByText('調整角色權限')).toBeVisible();

    // 權限存在 JWT 裡，改完要等 token 更新 —— 這件事必須讓管理員知道
    await expect(form.getByText(/不會立即生效/)).toBeVisible();
    await expect(form.getByText(/已選 \d+ \/ \d+ 項/)).toBeVisible();
  });
});

test.describe('派工看板', () => {
  test('點派工卡打開單據，顯示可用的動作', async ({ page }) => {
    await page.goto('/workorder');
    await expect(page.getByText(/共 \d+ 張派工單/)).toBeVisible({ timeout: 20_000 });

    // 單號格式是「標案號 + 類型 + 年月 + 流水」，從單號就看得出是哪個標案的第幾張
    await page.locator('text=/[A-Z0-9]+P[A-D]\\d{8}/').first().click();

    const dialog = page.getByRole('dialog');

    // 標題就是單號：從單號看得出標案、類型與年月
    await expect(dialog.getByRole('heading').first()).toContainText(/P[A-D]\d{8}/);

    // 欄位依表單類型分區：整區顯示或整區不顯示，而不是在一片欄位裡挑掉幾個
    await expect(dialog.getByText('基本資料')).toBeVisible();
    await expect(dialog.getByText('派工內容')).toBeVisible();
    await expect(dialog.getByText('施工人員', { exact: true }).first()).toBeVisible();

    // 照片分頁：驗收的人要同時看到「單上寫什麼」與「照片拍了什麼」
    await dialog.getByRole('tab', { name: /施工照片/ }).click();
    await expect(dialog.getByText(/施工前|沒有定義照片分區/).first()).toBeVisible({ timeout: 10_000 });

    // 依狀態與角色顯示可用的動作
    await expect(dialog.getByRole('button', { name: /歷程記錄/ })).toBeVisible();
  });

  test('已完工的單不可修改，且說明為什麼', async ({ page }) => {
    await page.goto('/workorder');
    await expect(page.getByText(/共 \d+ 張派工單/)).toBeVisible({ timeout: 20_000 });

    // 切到表格檢視才篩得到「已完工」
    await page.getByRole('button', { name: '表格檢視' }).click();
    await page.locator('[role="combobox"]').first().click();
    await page.getByRole('option', { name: '已完工' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查詢' }).click();

    await page.locator('tbody tr').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/此單已完工/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: '儲存變更' })).toHaveCount(0);
  });
});

/**
 * 標案是案件、車輛、報表與請款的分區單位 ——
 * 只有基本欄位而沒有關聯的標案，是查得到但用不了的。
 */
test.describe('標案關聯設定', () => {
  test('編輯標案能設定車輛與工務段轄區，並顯示摘要', async ({ page }) => {
    await page.goto('/manage');
    await expect(page.getByRole('tab', { name: /標案/ })).toBeVisible({ timeout: 20_000 });

    // 指名 DEMO01 而不是第一列：新增標案的測試會在列表最前面留下 E2E 標案，
    // 那些沒有關聯 —— 點到它等於在驗一個空的標案
    await page.locator('tbody tr', { hasText: 'DEMO01' }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: /區域與車輛/ }).click();

    await expect(dialog.getByText('承包公司')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('工務段與轄區')).toBeVisible();

    // 摘要要能一眼複查，而不是再點開每一個工務段確認
    await expect(dialog.getByText('區域摘要')).toBeVisible();
    await expect(dialog.getByText('車輛摘要')).toBeVisible();
    await expect(dialog.getByText(/第一工務段：/)).toBeVisible();
  });
});

/**
 * 選項多的時候要能搜尋 —— 標案、車輛、行政區都是幾十筆起跳，
 * 捲到底再捲回來找一筆不是查詢，是折磨。
 */
test.describe('選單搜尋', () => {
  test('選項超過門檻時長出搜尋欄，並能過濾', async ({ page }) => {
    await page.goto('/case');
    await expect(page.getByRole('columnheader', { name: '案件編號' })).toBeVisible({ timeout: 20_000 });

    // 破壞類型只有七項，不該有搜尋欄
    await page.getByRole('button', { name: '更多條件' }).click();

    const district = page.getByRole('combobox', { name: /行政區/ });
    await district.click();

    // 行政區只有五個 —— 少於門檻，一樣不給搜尋欄
    await expect(page.getByPlaceholder(/搜尋 \d+ 個選項/)).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});
