import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3008/api';

/**
 * 即時推播。
 *
 * 這是唯一需要「兩邊同時發生」才能驗的行為：
 * 從 API 建一筆案件，看瀏覽器裡的看板有沒有自己更新。
 * 少了這條，WebSocket 壞掉時前三層測試全都是綠的。
 */
test.describe('即時推播', () => {
  test('新案件透過 WebSocket 出現在儀表板', async ({ page, request }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('即時案件')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('已連線')).toBeVisible({ timeout: 15_000 });

    // 取一組登入 token 給 API 用(瀏覽器那邊用的是 httpOnly cookie，這裡拿不到)
    const login = await request.post(`${API}/user/authenticate`, {
      data: { COMPANY_KEY: 'DEMO', ACCOUNT: 'admin', PASSWORD: 'Demo1234' }
    });
    const token = (await login.json()).data.token;

    const externalId = `E2E-WS-${Date.now()}`;
    const created = await request.post(`${API}/patrol/case`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': externalId },
      data: {
        EXTERNAL_ID: externalId,
        DT_RECORD: new Date().toISOString(),
        PRJ_ID: 'DEMO01',
        CAR: 'DEMO-001',
        CRACK_TYPE: 'Potholes',
        DEGREE: 'A',
        LNG: 120.6478,
        LAT: 24.1636,
        LENGTH: 0.8,
        WIDTH: 0.5,
        AREA: 0.4
      }
    });
    expect(created.ok()).toBeTruthy();

    // 不重新整理：畫面要自己更新，那才是推播有效
    await expect(page.getByText(externalId)).toBeVisible({ timeout: 20_000 });
  });

  test('重送同一把 Idempotency-Key 不會產生第二筆', async ({ request }) => {
    const login = await request.post(`${API}/user/authenticate`, {
      data: { COMPANY_KEY: 'DEMO', ACCOUNT: 'admin', PASSWORD: 'Demo1234' }
    });
    const token = (await login.json()).data.token;

    const externalId = `E2E-IDEM-${Date.now()}`;
    const body = {
      EXTERNAL_ID: externalId,
      DT_RECORD: new Date().toISOString(),
      PRJ_ID: 'DEMO01',
      CAR: 'DEMO-002',
      CRACK_TYPE: 'Cracking',
      DEGREE: 'B',
      LNG: 120.65,
      LAT: 24.165,
      LENGTH: 1.8,
      WIDTH: 0.5,
      AREA: 0.9
    };
    const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': externalId };

    const first = await (await request.post(`${API}/patrol/case`, { headers, data: body })).json();
    const second = await (await request.post(`${API}/patrol/case`, { headers, data: body })).json();

    // 回放的是第一次的完整回應，所以連 ID 都一樣
    expect(second.data.ID).toBe(first.data.ID);

    const list = await (
      await request.get(`${API}/patrol/case?EXTERNAL_ID=${externalId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ).json();
    expect(list.data.TOTAL).toBe(1);
  });
});
