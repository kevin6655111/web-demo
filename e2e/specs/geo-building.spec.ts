import { expect, test } from '@playwright/test';

/**
 * 地理資料：行政區界線與建物。
 *
 * 這兩個圖層是**判讀時的參考框**，不是資料本身 ——
 * 但它們一壞，壞的方式很安靜：界線查不到只會讓案件的里別變成空白，
 * 建物查不到只會讓圖上少一層，沒有人會收到錯誤訊息。
 * 所以要用測試釘住它們還在。
 */

test.describe('行政區界線', () => {
  test('三個層級都查得到，且里的數量多於區、區多於縣市', async ({ request }) => {
    const counts: Record<string, number> = {};

    for (const level of ['COUNTY', 'DISTRICT', 'VILLAGE']) {
      const res = await request.get('/api/geo/region', { params: { LEVEL: level } });
      expect(res.status(), `${level} 應查得到`).toBe(200);

      const body = await res.json();
      counts[level] = body.data.features.length;
      expect(counts[level], `${level} 不應為空`).toBeGreaterThan(0);
    }

    // 行政區劃是巢狀的；反過來的話代表匯入的層級標錯了
    expect(counts.VILLAGE).toBeGreaterThan(counts.DISTRICT);
    expect(counts.DISTRICT).toBeGreaterThan(counts.COUNTY);
  });

  test('每個界線都有可讀的名字 —— 圖上標不出名字的界線等於沒有用', async ({ request }) => {
    const res = await request.get('/api/geo/region', { params: { LEVEL: 'VILLAGE' } });
    const body = await res.json();

    for (const f of body.data.features) {
      expect(f.properties.label, '界線要有 label').toBeTruthy();
      expect(f.geometry.type).toBe('Polygon');
    }
  });

  test('座標落點查詢對同一個點永遠給同一個答案', async ({ request }) => {
    const params = { LNG: '120.6478', LAT: '24.1636' };
    const first = await (await request.get('/api/geo/locate', { params })).json();
    const second = await (await request.get('/api/geo/locate', { params })).json();

    expect(second.data).toEqual(first.data);
  });
});

test.describe('建物', () => {
  test('回傳輪廓、用途與樓高，且不含任何住戶資訊', async ({ request }) => {
    const res = await request.get('/api/geo/building');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data.features.length).toBeGreaterThan(0);

    for (const f of body.data.features.slice(0, 20)) {
      expect(f.geometry.type).toBe('Polygon');
      expect(f.properties.levels).toBeGreaterThan(0);

      // 這個圖層的用途是判斷施工影響，不是查誰住在裡面 ——
      // 多出這類欄位就是把一個參考圖層變成個資來源
      for (const forbidden of ['owner', 'resident', 'household', 'address', 'phone']) {
        expect(f.properties[forbidden], `建物不應回傳 ${forbidden}`).toBeUndefined();
      }
    }
  });

  test('樓層篩選真的生效，而不是被安靜忽略', async ({ request }) => {
    const res = await request.get('/api/geo/building', { params: { MIN_LEVELS: '10' } });
    const body = await res.json();

    expect(body.data.features.length).toBeGreaterThan(0);
    for (const f of body.data.features) expect(f.properties.levels).toBeGreaterThanOrEqual(10);
  });

  test('建物的行政區欄位與它實際的位置一致', async ({ request }) => {
    const res = await request.get('/api/geo/building', { params: { DISTRICT: '西屯區' } });
    const body = await res.json();

    expect(body.data.features.length).toBeGreaterThan(0);
    for (const f of body.data.features) expect(f.properties.district).toBe('西屯區');
  });

  test('周邊影響評估把學校與醫院單獨算出來', async ({ request }) => {
    const res = await request.get('/api/geo/building-impact', {
      params: { LNG: '120.6478', LAT: '24.1636', RADIUS: '2000' }
    });
    expect(res.status()).toBe(200);

    const { data } = await res.json();
    const sensitive = data.BY_USAGE.filter((u: { usage: string }) => ['SCHOOL', 'HOSPITAL'].includes(u.usage)).reduce(
      (s: number, u: { count: number }) => s + u.count,
      0
    );

    // SENSITIVE 是交維計畫要不要送審的依據，算錯會讓該送審的案子沒送
    expect(data.SENSITIVE).toBe(sensitive);
    expect(data.TOTAL).toBe(data.BY_USAGE.reduce((s: number, u: { count: number }) => s + u.count, 0));
    if (data.SENSITIVE > 0) expect(data.NOTE).toBeTruthy();
  });
});
