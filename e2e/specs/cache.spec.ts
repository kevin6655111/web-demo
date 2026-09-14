import { expect, test } from '@playwright/test';

/**
 * 快取的正確性。
 *
 * 快取最危險的失誤不是「拿到舊資料」，而是**回應的形狀改變**：
 * 未命中時回傳陣列、命中時回傳物件，前端的 `.map()` 會在第二次載入時失敗。
 * 而這種錯誤在單次測試中不會出現 —— 必須連續呼叫兩次才看得到。
 *
 * 實際發生過：快取命中時用物件展開包裝回應，把 `data` 陣列變成
 * `{ 0: ..., 1: ... }`，案件與管理頁在第二次開啟時整頁空白。
 */
test.describe('回應快取', () => {
  test('標案清單在快取命中前後的形狀一致', async ({ request }) => {
    const first = await (await request.get('/api/project')).json();
    const second = await (await request.get('/api/project')).json();
    const third = await (await request.get('/api/project')).json();

    // 三次都必須是陣列；只驗一次的話，未命中的那次會讓測試通過
    for (const [label, body] of [
      ['第一次', first],
      ['第二次', second],
      ['第三次', third]
    ] as const) {
      expect(Array.isArray(body.data), `${label}的 data 應為陣列`).toBe(true);
    }

    expect(second.data).toEqual(first.data);
    expect(third.data).toEqual(first.data);

    // 至少有一次命中，否則這條測試沒有真的走到快取路徑
    expect([second.cached, third.cached].some(Boolean), '第二次或第三次應取自快取').toBe(true);
  });

  test('行政區界線在快取命中前後的形狀一致', async ({ request }) => {
    const first = await (await request.get('/api/geo/district-bounds')).json();
    const second = await (await request.get('/api/geo/district-bounds')).json();

    expect(first.data.type).toBe('FeatureCollection');
    expect(second.data.type).toBe('FeatureCollection');
    expect(Array.isArray(second.data.features)).toBe(true);
    expect(second.data).toEqual(first.data);

    // 界線由案件位置推導，示範資料必定產生得出來 —— 空的代表查詢壞了
    expect(second.data.features.length).toBeGreaterThan(0);
  });

  test('建立標案會清掉快取，列表立刻看得到新的那一筆', async ({ request }) => {
    await request.get('/api/project'); // 先讓快取有東西

    const prjId = `CT${Date.now() % 100000}`;
    const created = await request.post('/api/project', {
      data: {
        PRJ_ID: prjId,
        PRJ_NAME: '快取失效測試',
        PRJ_MAIN: '快取失效測試標案',
        PROPRIETOR: '示範市政府建設局',
        PROPRIETOR_LEVEL: 2,
        // 用已結束的期間：測試建立的標案不能出現在 `?CURRENT=true` 的結果裡，
        // 否則它會排在清單最前面，讓其他「取第一筆標案」的測試拿到一個沒有關聯的標案
        START_DATE: '2020-01-01',
        END_DATE: '2020-12-31'
      }
    });
    expect(created.ok()).toBeTruthy();

    const after = await (await request.get('/api/project')).json();
    expect(Array.isArray(after.data)).toBe(true);
    expect(
      after.data.some((p: { PRJ_ID: string }) => p.PRJ_ID === prjId),
      '新建的標案應立即出現在清單中'
    ).toBe(true);
  });
});
