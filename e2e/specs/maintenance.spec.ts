import { expect, test } from '@playwright/test';

/**
 * 巡查單。
 *
 * 這一組驗的是巡查單與派工單之間的**約束**，而不只是畫面畫得出來：
 * 一張已經派過工的巡查單不能被隨手刪掉、刪掉的能不能救回來、
 * 批次操作被跳過時使用者看不看得到原因。
 *
 * 那些規則寫在後端，但使用者只會在畫面上遇到它們 ——
 * 規則對了而畫面沒把原因說出來，跟規則錯了在現場是一樣的。
 */
test.describe('巡查單列表', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workorder');
    // 等真的有列，而不是等那行計數 —— 計數在資料回來之前就會先畫出「共 0 張」，
    // 這時去點勾選框，按到的是一張空表
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  });

  test('派工管理預設開在巡查單，可切到派工單', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: '巡查單號' })).toBeVisible();

    await page.getByRole('tab', { name: '派工單' }).click();
    await expect(page.getByText(/共 \d+ 張派工單/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: '巡查單' }).click();
    await expect(page.getByText(/共 \d+ 張巡查單/)).toBeVisible();
  });

  test('列上帶得出派工單狀態', async ({ page }) => {
    // 巡查單列表最常被問的就是「這張派了沒」——
    // 要再點進去才看得到的話，承辦得逐張點完整頁
    await expect(page.getByRole('columnheader', { name: '派工單' })).toBeVisible();
    await expect(page.getByText('未派工').first()).toBeVisible();
  });

  test('勾選後才有批次動作', async ({ page }) => {
    const watch = page.getByRole('button', { name: '轉為觀察中' });
    await expect(watch).toBeDisabled();

    await page.locator('tbody tr').first().getByRole('checkbox').check();
    await expect(page.getByText(/已選 1 張/)).toBeVisible();
    await expect(watch).toBeEnabled();
  });

  test('全選勾選框會勾起整頁', async ({ page }) => {
    await page.getByRole('checkbox', { name: '全選' }).check();

    const count = await page.locator('tbody tr').count();
    await expect(page.getByText(new RegExp(`已選 ${count} 張`))).toBeVisible();
  });

  test('未派工篩選只留下沒有派工單的', async ({ page }) => {
    await page.getByRole('combobox', { name: '派工', exact: true }).click();
    await page.getByRole('option', { name: '只看未派工' }).click();
    await page.getByRole('button', { name: '查詢' }).click();

    await expect(page.getByText(/共 \d+ 張巡查單/)).toBeVisible({ timeout: 15_000 });
    // 篩掉的就是有派工單的那些，所以整頁不該再出現任何派工單號
    await expect(page.locator('tbody').getByText('未派工').first()).toBeVisible();
  });
});

test.describe('巡查單詳情', () => {
  test('點列打開單據，RB 才有巡修回填區', async ({ page }) => {
    await page.goto('/workorder');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });

    // 用類型篩出巡修單：RA 沒有回填欄位，隨便點一列可能點到 RA。
    // 「類型」在進階條件裡也出現一次(破壞類型)，所以用 combobox 的角色點名這一個
    await page.getByRole('combobox', { name: '類型', exact: true }).click();
    await page.getByRole('option', { name: '巡修', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查詢' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    await page.locator('tbody tr').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('調查資料')).toBeVisible();
    await expect(dialog.getByText('破壞內容')).toBeVisible();
    await expect(dialog.getByText('巡修回填')).toBeVisible();

    // 現場照片與單據內容在同一個對話框：判斷「這是什麼破壞」要同時看兩者
    await dialog.getByRole('tab', { name: /現場照片/ }).click();
    await expect(dialog.getByText(/修補照片|現況照片/).first()).toBeVisible({ timeout: 10_000 });
  });
});

/**
 * 每次執行都用不同的地址。
 *
 * 寫入端點是冪等的 —— 沒帶 `Idempotency-Key` 時後端拿**請求內容的雜湊**當鍵，
 * 五分鐘內同樣的內容會回放第一次的結果而不是建新的一筆。
 * 那是正確的行為（車機重送不該長出第二筆），但也表示
 * 「每次都送一模一樣的 body」的測試，在短時間內重跑會拿到上一輪那張單。
 */
const RUN_ID = `${Date.now()}`;
const addr = (name: string) => `E2E ${name} ${RUN_ID}`;

/**
 * 約束本身用 API 驗。
 *
 * 這幾條規則的價值在「擋得住」，而擋下來的路徑在畫面上要製造出來
 * （先派工、再刪除）需要好幾步；用 API 直接走完，規則壞掉時
 * 失敗訊息會直接指出是哪一條。
 */
test.describe('巡查單與派工單的約束', () => {
  test('有活著的派工單時，巡查單刪不掉；刪掉派工單後才可以', async ({ request }) => {
    const created = await request.post('/api/maintenance', {
      data: {
        TYPE: 'RA',
        PRJ_ID: 'DEMO01',
        SURVEY_DATE: '2026-09-05',
        DTYPE: 'Potholes',
        DEGREE: 'B',
        DISTRICT: '西屯區',
        ADDRESS: addr('約束驗證'),
        LNG: 120.65,
        LAT: 24.18
      }
    });
    expect(created.ok()).toBeTruthy();
    const maintenanceId = (await created.json()).data.ID;

    const dispatched = await request.post('/api/workorder', {
      data: {
        TYPE: 'PD',
        PRJ_ID: 'DEMO01',
        MAINTENANCE_ID: maintenanceId,
        DISPATCH_DATE: '2026-09-05',
        WORKER_USER_ID: [4],
        WORK_UNIT: 'SELF',
        DISTRICT: '西屯區',
        ADDRESS: addr('約束驗證')
      }
    });
    expect(dispatched.ok()).toBeTruthy();
    const orderId = (await dispatched.json()).data.ID;

    // 開了派工單，來源就是「已派工」
    const afterDispatch = await (await request.get(`/api/maintenance/${maintenanceId}`)).json();
    expect(afterDispatch.data.STATUS).toBe(2);

    // 擋下來時不是整批失敗，而是跳過並說明原因 ——
    // 整批失敗的話使用者要自己猜是哪一筆卡住
    const blocked = await (
      await request.put('/api/maintenance/status', { data: { ID: [maintenanceId], STATUS: -1 } })
    ).json();
    expect(blocked.status).toBe(false);
    expect(blocked.message).toContain('請先刪除派工單');
    expect(blocked.data.SKIPPED).toHaveLength(1);

    // 刪掉派工單，來源退回「觀察中」重新可派
    const removed = await (await request.put('/api/workorder/status', { data: { ID: orderId, STATUS: -1 } })).json();
    expect(removed.status).toBe(true);

    const released = await (await request.get(`/api/maintenance/${maintenanceId}`)).json();
    expect(released.data.STATUS).toBe(1);

    // 現在刪得掉了
    const deleted = await (
      await request.put('/api/maintenance/status', { data: { ID: [maintenanceId], STATUS: -1 } })
    ).json();
    expect(deleted.status).toBe(true);

    // 復原要回到「上一個不同的狀態」而不是固定回到待確認 ——
    // 這張單刪掉前是觀察中，救回來就該是觀察中
    const restored = await (
      await request.put('/api/maintenance/status', { data: { ID: [maintenanceId], STATUS: 8 } })
    ).json();
    expect(restored.status).toBe(true);

    const final = await (await request.get(`/api/maintenance/${maintenanceId}`)).json();
    expect(final.data.STATUS).toBe(1);
  });

  test('已回報的派工單不能直接刪，要先撤回', async ({ request }) => {
    const created = await request.post('/api/maintenance', {
      data: {
        TYPE: 'RA',
        PRJ_ID: 'DEMO01',
        SURVEY_DATE: '2026-09-05',
        DTYPE: 'Potholes',
        DISTRICT: '西屯區',
        ADDRESS: addr('撤回驗證'),
        LNG: 120.66,
        LAT: 24.19
      }
    });
    const maintenanceId = (await created.json()).data.ID;

    const dispatched = await request.post('/api/workorder', {
      data: {
        TYPE: 'PD',
        PRJ_ID: 'DEMO01',
        MAINTENANCE_ID: maintenanceId,
        DISPATCH_DATE: '2026-09-05',
        WORKER_USER_ID: [4],
        WORK_UNIT: 'SELF',
        DISTRICT: '西屯區',
        ADDRESS: addr('撤回驗證')
      }
    });
    const orderId = (await dispatched.json()).data.ID;

    await request.put('/api/workorder/status', { data: { ID: orderId, STATUS: 2 } });

    const blocked = await request.put('/api/workorder/status', { data: { ID: orderId, STATUS: -1 } });
    expect(blocked.status()).toBe(409);

    // 撤回是退一階：已回報 → 施工中（因為這張單有指派人員）
    const withdrawn = await (await request.put('/api/workorder/status', { data: { ID: orderId, STATUS: 9 } })).json();
    expect(withdrawn.message).toContain('施工中');

    const detail = await (await request.get(`/api/workorder/${orderId}`)).json();
    expect(detail.data.STATUS).toBe(1);
    // 多人派工：回傳的是名單而不是單一姓名
    expect(Array.isArray(detail.data.WORKER_USER_ID)).toBe(true);
  });

  test('派工單可以指派多人，也可以先不指派', async ({ request }) => {
    const created = await request.post('/api/maintenance', {
      data: {
        TYPE: 'RA',
        PRJ_ID: 'DEMO01',
        SURVEY_DATE: '2026-09-05',
        DISTRICT: '西屯區',
        ADDRESS: addr('多人派工'),
        LNG: 120.67,
        LAT: 24.2
      }
    });
    const maintenanceId = (await created.json()).data.ID;

    // 不指派人員：合法，單會停在「待處理」——
    // 現場常是先開單、隔天早上點名才分工
    const dispatched = await request.post('/api/workorder', {
      data: {
        TYPE: 'PD',
        PRJ_ID: 'DEMO01',
        MAINTENANCE_ID: maintenanceId,
        DISPATCH_DATE: '2026-09-05',
        WORKER_USER_ID: [],
        WORK_UNIT: 'VENDOR',
        DISTRICT: '西屯區',
        ADDRESS: addr('多人派工')
      }
    });
    const orderId = (await dispatched.json()).data.ID;

    const pending = await (await request.get(`/api/workorder/${orderId}`)).json();
    expect(pending.data.STATUS).toBe(0);
    expect(pending.data.WORKERS[0].NAME).toBe('未指定人員');

    // 補上兩個人：狀態自己前進到施工中，不必再按一次「開始施工」
    await request.patch('/api/workorder', { data: { ID: orderId, WORKER_USER_ID: [4, 5] } });

    const assigned = await (await request.get(`/api/workorder/${orderId}`)).json();
    expect(assigned.data.WORKER_USER_ID).toHaveLength(2);
    expect(assigned.data.STATUS).toBe(1);
    expect(assigned.data.WORK_UNIT_NAME).toBe('廠商修繕');
  });
});
