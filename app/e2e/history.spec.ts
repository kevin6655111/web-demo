import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3008/api';

async function login(request: any): Promise<string> {
  const res = await request.post(`${API}/user/authenticate`, {
    data: { COMPANY_KEY: 'DEMO', ACCOUNT: 'admin', PASSWORD: 'Demo1234' }
  });

  return (await res.json()).data.token;
}

/**
 * 版本化歷程。
 *
 * 歷程只增不改：把狀態改回去也會產生新版本。
 * 這一組驗的就是那個性質 —— 還原之後版本數要「變多」，不是「回到過去」。
 */
test.describe('版本歷程與還原', () => {
  test('修改案件產生新版本，還原本身也是一個新版本', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/patrol/case?SIZE=1&STATUS=1`, { headers })).json();
    const id = list.data.ROWS[0].ID;

    const before = await (await request.get(`${API}/history/CASE_PATROL/${id}`, { headers })).json();
    const baseCount = (before.data ?? []).length;

    // 挑一個與目前不同的程度：送出相同的值不會產生差異，
    // 那樣測到的是「沒變更也寫了一版」而不是「變更有被記錄」
    const current = await (await request.get(`${API}/patrol/case/${id}`, { headers })).json();
    const nextDegree = current.data.DEGREE === 'A' ? 'C' : 'A';

    const updated = await request.patch(`${API}/patrol/case`, {
      headers,
      data: { ID: id, DEGREE: nextDegree, REMARK: `E2E ${Date.now()}` }
    });
    expect(updated.ok()).toBeTruthy();

    const afterEdit = await (await request.get(`${API}/history/CASE_PATROL/${id}`, { headers })).json();
    expect(afterEdit.data.length).toBe(baseCount + 1);

    const latest = afterEdit.data[afterEdit.data.length - 1];
    expect(latest.ACTION).toBe('UPDATED');
    expect(Object.keys(latest.CHANGES)).toContain('degree');
    // 快照要完整：還原前想看的是「還原成什麼」，不只是「動了什麼」
    expect(latest.SNAPSHOT).toHaveProperty('crackType');
    expect(latest.MODIFIED_BY).toBeTruthy();

    // 比較兩版
    const diff = await (
      await request.get(`${API}/history/CASE_PATROL/${id}/diff?CASE_TYPE=CASE_PATROL&FROM=${latest.VERSION - 1}&TO=${latest.VERSION}`, {
        headers
      })
    ).json();
    expect(diff.data.CHANGES).toHaveProperty('degree');

    // 還原：不刪任何版本，而是再加一個
    const restored = await request.post(`${API}/history/restore`, {
      headers,
      data: { CASE_TYPE: 'CASE_PATROL', ID: id, VERSION: latest.VERSION - 1 }
    });
    expect(restored.ok()).toBeTruthy();

    const afterRestore = await (await request.get(`${API}/history/CASE_PATROL/${id}`, { headers })).json();
    expect(afterRestore.data.length).toBe(baseCount + 2);
    expect(afterRestore.data[afterRestore.data.length - 1].ACTION).toBe('RESTORED');
  });

  test('派工單有自己的歷程時間軸', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/workorder?SIZE=1&STATUS=3`, { headers })).json();
    const id = list.data.ROWS[0].ID;

    const history = await (await request.get(`${API}/history/WORK_ORDER/${id}`, { headers })).json();
    expect(history.data.length).toBeGreaterThan(0);
    expect(history.data[0].ACTION).toBe('CREATED');
    expect(history.data[0].SNAPSHOT).toHaveProperty('caseNum');
  });

  test('稽核查詢跨實體回答「這段期間誰改了什麼」', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const audit = await (await request.get(`${API}/history/audit`, { headers })).json();
    expect(audit.data.length).toBeGreaterThan(0);

    for (const row of audit.data.slice(0, 5)) {
      expect(row).toHaveProperty('CASE_TYPE');
      expect(row).toHaveProperty('VERSION');
      expect(row).toHaveProperty('MODIFIED_AT');
    }
  });

  test('檢測案件不支援還原：數值來自儀器，人工只標註不改值', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const res = await request.post(`${API}/history/restore`, {
      headers,
      data: { CASE_TYPE: 'SURVEY', ID: 1, VERSION: 1 }
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('不支援');
  });
});
