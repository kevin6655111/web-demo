import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3008/api';

async function login(request: any): Promise<string> {
  const res = await request.post(`${API}/user/authenticate`, {
    data: { COMPANY_KEY: 'DEMO', ACCOUNT: 'admin', PASSWORD: 'Demo1234' }
  });

  return (await res.json()).data.token;
}

/**
 * 查詢條件。
 *
 * 條件多的時候，壞掉的通常不是「查不到」而是「條件被忽略」——
 * 那種錯誤看起來一切正常，只是結果不對。所以每個條件都要驗它真的有生效。
 */
test.describe('案件查詢條件', () => {
  test('每個查詢條件都真的有縮小結果，不是被忽略', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const all = await (await request.get(`${API}/patrol/case?SIZE=1`, { headers })).json();
    const total = all.data.TOTAL;
    expect(total).toBeGreaterThan(0);

    const cases: [string, string][] = [
      ['二篩狀態', 'STATUS=1'],
      ['修繕狀態', 'NEED_REPAIR=1'],
      ['破壞類型', 'CRACK_TYPE=Potholes'],
      ['破壞程度', 'DEGREE=A'],
      ['行政區', 'DISTRICT=西屯區'],
      ['路名', 'ROAD=中山路'],
      ['車牌', 'CAR=DEMO-001'],
      ['面積下限', 'AREA_MIN=1.5'],
      ['未派工', 'UNDISPATCHED=true'],
      ['關鍵字', 'KEYWORD=中山']
    ];

    for (const [label, query] of cases) {
      const res = await (await request.get(`${API}/patrol/case?SIZE=1&${query}`, { headers })).json();
      expect(res.data.TOTAL, `${label} 條件沒有生效`).toBeLessThan(total);
    }
  });

  test('多選條件用逗號帶，回傳的是聯集', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const a = await (await request.get(`${API}/patrol/case?SIZE=1&CRACK_TYPE=Potholes`, { headers })).json();
    const b = await (await request.get(`${API}/patrol/case?SIZE=1&CRACK_TYPE=Cracking`, { headers })).json();
    const both = await (await request.get(`${API}/patrol/case?SIZE=1&CRACK_TYPE=Potholes,Cracking`, { headers })).json();

    expect(both.data.TOTAL).toBe(a.data.TOTAL + b.data.TOTAL);
  });

  test('不合法的代碼被驗證擋下，而不是安靜地回全部', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const res = await request.get(`${API}/patrol/case?CRACK_TYPE=NOT_A_TYPE`, { headers });
    expect(res.status()).toBe(400);
  });

  test('派工單的逾期與缺件篩選', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const all = await (await request.get(`${API}/workorder?SIZE=1`, { headers })).json();

    const overdue = await (await request.get(`${API}/workorder?SIZE=1&OVERDUE=true`, { headers })).json();
    expect(overdue.data.TOTAL).toBeLessThanOrEqual(all.data.TOTAL);

    const missing = await (await request.get(`${API}/workorder?SIZE=200&MISSING_IMAGE=true`, { headers })).json();
    for (const row of (missing.data?.ROWS ?? []).slice(0, 10)) {
      expect(row.MISSING_IMAGE_COUNT).toBeGreaterThan(0);
    }
  });

  test('標案關聯查得到公司、車輛與工務段轄區', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/project?CURRENT=true`, { headers })).json();
    expect(list.data.length).toBeGreaterThan(0);

    const detail = await (await request.get(`${API}/project/${list.data[0].ID}`, { headers })).json();
    expect(detail.data.COMPANIES.length).toBeGreaterThan(0);
    expect(detail.data.VEHICLES.length).toBeGreaterThan(0);
    // 轄區掛在「標案-工務段」之下，所以要能一路帶出行政區
    expect(detail.data.SECTIONS[0].AREAS.length).toBeGreaterThan(0);
  });
});
