import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3008/api';

/** 1×1 的 PNG；內容不重要，重要的是它真的是一張圖 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function login(request: any): Promise<string> {
  const res = await request.post(`${API}/user/authenticate`, {
    data: { COMPANY_KEY: 'DEMO', ACCOUNT: 'admin', PASSWORD: 'Demo1234' }
  });

  return (await res.json()).data.token;
}

/**
 * 派工單照片。
 *
 * 這一組驗的是「照片與驗收的連動」——
 * 缺照片的完工單在驗收時會被退回，所以系統要在標記完工時就擋住。
 * 少了這條，缺件會一路走到驗收才被人發現，那張單要再跑一輪。
 */
test.describe('派工單照片', () => {
  test('缺必要照片時不能標記完工，補齊後才能', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    // 任何還沒完工的 PC 單都可以：它需要施工前後各一張。
    // 綁死在「施工中」的話，示範資料的隨機狀態分布會讓這個測試時而被跳過 ——
    // 而被跳過的測試等於沒有測試
    const list = await (await request.get(`${API}/workorder?STATUS=0,1,2&TYPE=PC&SIZE=1`, { headers })).json();
    expect(list.data?.ROWS?.length, '應該要有未完工的 PC 派工單可測').toBeGreaterThan(0);

    const id = list.data.ROWS[0].ID;

    // 先清乾淨，測試才不會被前一次的殘留影響
    for (const type of ['IMG_BEFORE', 'IMG_AFTER']) {
      await request.delete(`${API}/workorder/image`, { headers, data: { ID: id, IMG_TYPE: type } });
    }

    const blocked = await request.put(`${API}/workorder/status`, { headers, data: { ID: id, STATUS: 3 } });
    expect(blocked.status()).toBe(400);
    expect((await blocked.json()).message).toContain('缺少必要照片');

    // 欄位名就是照片類型，一次可以傳多種
    const uploaded = await request.post(`${API}/workorder/image`, {
      headers,
      multipart: {
        ID: String(id),
        IMG_BEFORE: { name: 'before.png', mimeType: 'image/png', buffer: PNG },
        IMG_AFTER: { name: 'after.png', mimeType: 'image/png', buffer: PNG }
      }
    });
    expect(uploaded.ok()).toBeTruthy();

    const images = await (await request.get(`${API}/workorder/${id}/image`, { headers })).json();
    expect(images.data.MISSING).toHaveLength(0);
    // 下載網址是短效簽發的，不該存起來重複使用
    expect(images.data.IMAGES[0].URL).toContain('http');

    const ok = await request.put(`${API}/workorder/status`, { headers, data: { ID: id, STATUS: 3 } });
    expect(ok.ok()).toBeTruthy();

    // 完工**不動**案件狀態：案件只有 待確認/觀察中/已派工/已刪除 四種，
    // 沒有「已完修」—— 修完了是派工單的事實(status=3)，不是案件的狀態。
    // 硬塞一個值進去，同一個欄位就會表達兩件事，而報表要分開統計
    const detail = await (await request.get(`${API}/workorder/${id}`, { headers })).json();
    expect(detail.data.STATUS).toBe(3);

    const caseId = detail.data.CASE_PATROL_ID;
    if (caseId) {
      const source = await (await request.get(`${API}/patrol/case/${caseId}`, { headers })).json();
      expect(source.data.NEED_REPAIR).toBe(2);
    }
  });

  test('退回會把來源案件放回觀察中，讓它重新進入待派工', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/workorder?STATUS=2&SIZE=1`, { headers })).json();
    expect(list.data?.ROWS?.length).toBeGreaterThan(0);

    const id = list.data.ROWS[0].ID;
    const detail = await (await request.get(`${API}/workorder/${id}`, { headers })).json();
    const caseId = detail.data.CASE_PATROL_ID;

    await request.put(`${API}/workorder/status`, { headers, data: { ID: id, STATUS: 0, REJECT_REASON: '邊緣未壓實' } });

    if (caseId) {
      const source = await (await request.get(`${API}/patrol/case/${caseId}`, { headers })).json();
      expect(source.data.NEED_REPAIR).toBe(1);
    }

    // 還原，避免影響其他測試
    await request.put(`${API}/workorder/status`, { headers, data: { ID: id, STATUS: 2 } });
  });

  test('同一類型重傳是覆寫而不是長出第二筆', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/workorder?SIZE=1`, { headers })).json();
    const id = list.data.ROWS[0].ID;

    for (let i = 0; i < 2; i += 1) {
      const res = await request.post(`${API}/workorder/image`, {
        headers,
        multipart: { ID: String(id), IMG_BEFORE: { name: `retake-${i}.png`, mimeType: 'image/png', buffer: PNG } }
      });
      expect(res.ok()).toBeTruthy();
    }

    const images = await (await request.get(`${API}/workorder/${id}/image`, { headers })).json();
    const before = images.data.IMAGES.filter((i: { IMG_TYPE: string }) => i.IMG_TYPE === 'IMG_BEFORE');

    // 現場重拍是常態；驗收要的是「這個階段的照片」，不是同階段的二十張
    expect(before).toHaveLength(1);
    expect(before[0].IMG_NAME).toBe('retake-1.png');
  });

  test('副檔名與 MIME 不符的檔案被擋在上傳這一層', async ({ request }) => {
    const token = await login(request);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/workorder?SIZE=1`, { headers })).json();
    const id = list.data.ROWS[0].ID;

    const res = await request.post(`${API}/workorder/image`, {
      headers,
      multipart: {
        ID: String(id),
        IMG_BEFORE: { name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }
      }
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('不符規則');
  });
});
