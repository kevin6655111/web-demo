import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3008/api';

async function login(request: any, company: string, account: string) {
  const res = await request.post(`${API}/user/authenticate`, {
    data: { COMPANY_KEY: company, ACCOUNT: account, PASSWORD: 'Demo1234' }
  });

  const body = await res.json();
  return { token: body.data.token, user: body.data.user };
}

/**
 * 用公司代碼查 id，不要寫死數字。
 *
 * 公司 id 依建立順序而定，而平台層那一筆是 migration 補的 ——
 * 全新的資料庫與長期運行的資料庫，同一個代碼會落在不同的 id 上。
 * 寫死 id 的測試只在寫它的那台機器上會過。
 */
async function companyId(request: any, token: string, code: string): Promise<number> {
  const list = await (await request.get(`${API}/company`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const found = (list.data ?? []).find((c: { CODE: string }) => c.CODE === code);

  if (!found) throw new Error(`查無公司代碼 ${code}`);
  return found.ID;
}

/**
 * 三層組織與授權傳遞。
 *
 * 平台 → 廠商 → 外包。這一組驗的是兩條規則：
 * 看得到的只有自己的子樹，開不出自己沒有的權限。
 *
 * 少了這些測試，權限外洩不會有任何徵兆 —— 系統看起來一切正常，
 * 只是某個外包單位多了一項它不該有的功能。
 */
test.describe('三層組織', () => {
  test('角色權限會被公司開通清單截斷', async ({ request }) => {
    // 外包負責人的角色是「系統管理員」(全權限)，但公司只被開通七項
    const sub = await login(request, 'SUB01', 'suboffice');
    const contractor = await login(request, 'DEMO', 'admin');

    expect(sub.user.roleName).toBe('系統管理員');
    expect(contractor.user.roleName).toBe('系統管理員');

    // 同一個角色、不同公司，拿到的權限不同 —— 差別就是公司被開通了什麼
    expect(sub.user.actions.length).toBeLessThan(contractor.user.actions.length);
    expect(sub.user.actions).toContain('WORK_ORDER.UPDATE');

    // 派工與驗收沒開通給外包：施工的人不該能自己派工給自己、也不該能自己驗收
    expect(sub.user.actions).not.toContain('WORK_ORDER.CREATE');
    expect(sub.user.actions).not.toContain('WORK_ORDER.ACCEPT');
    expect(sub.user.actions).not.toContain('PROJECT.CREATE');
  });

  test('廠商看不到平台，也拿不到平台的資料', async ({ request }) => {
    const { token, user } = await login(request, 'DEMO', 'admin');
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get(`${API}/company`, { headers })).json();
    const codes = (list.data ?? []).map((c: { CODE: string }) => c.CODE);

    // 只看得到自己底下的外包，看不到平台，也看不到別的廠商
    expect(codes).toContain('SUB01');
    expect(codes).not.toContain('ROOT');
    expect(codes).not.toContain('DEMO');

    // 直接用 id 打也拿不到：這不是畫面上的隱藏，查詢本身就以子樹收斂。
    //
    // 不寫死 id ——「平台是 2 號」只是這份示範資料剛好如此。
    // 掃一段 id，凡是不在自己子樹裡的都必須回 404：
    // 回 403 等於承認「有這個公司但你不能碰」，本身就洩漏了它的存在
    const ownSubtree = new Set<number>([user.companyId, ...(list.data ?? []).map((c: { ID: number }) => c.ID)]);

    let probed = 0;
    for (let id = 1; id <= 8; id += 1) {
      if (ownSubtree.has(id)) continue;

      const res = await request.get(`${API}/company/${id}/grant`, { headers });
      expect(res.status(), `id ${id} 應該對廠商不可見`).toBe(404);
      probed += 1;
    }

    // 至少要真的掃到平台那一筆，否則這個測試等於什麼都沒驗
    expect(probed).toBeGreaterThan(0);
  });

  test('平台看得到整棵子樹', async ({ request }) => {
    const { token } = await login(request, 'ROOT', 'root');
    const list = await (await request.get(`${API}/company`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const codes = (list.data ?? []).map((c: { CODE: string }) => c.CODE);

    expect(codes).toContain('DEMO');
    expect(codes).toContain('SUB01');
  });

  test('開不出自己沒有的權限', async ({ request }) => {
    const { token } = await login(request, 'DEMO', 'admin');
    const headers = { Authorization: `Bearer ${token}` };

    const grantable = await (await request.get(`${API}/company/grantable`, { headers })).json();
    expect(grantable.data.CAN_CREATE_SUB).toBe(true);

    // 廠商有 PROJECT.CREATE，所以這裡改用一個不存在的動作驗證白名單
    const bogus = await request.put(`${API}/company/grant`, {
      headers,
      data: { COMPANY_ID: await companyId(request, token, 'SUB01'), ACTIONS: ['NOT.A.REAL.ACTION'] }
    });
    expect(bogus.status()).toBe(400);
  });

  test('外包不能再往下建單位 —— 三層是責任邊界', async ({ request }) => {
    const { token } = await login(request, 'SUB01', 'suboffice');

    const res = await request.post(`${API}/company`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { CODE: 'SUB99', NAME: '再下一層' }
    });

    // 外包連 ACCOUNT.CREATE 都沒被開通，所以擋在權限這一關就結束了
    expect(res.status()).toBe(403);
  });

  test('收回權限會連帶收回下層的那一份', async ({ request }) => {
    const { token } = await login(request, 'ROOT', 'root');
    const headers = { Authorization: `Bearer ${token}` };

    const contractorId = await companyId(request, token, 'DEMO');
    const subId = await companyId(request, token, 'SUB01');

    const before = await (await request.get(`${API}/company/${subId}/grant`, { headers })).json();
    const subActive = before.data.GRANTS.filter((g: { IS_ACTIVE: boolean }) => g.IS_ACTIVE).map((g: { ACTION_KEY: string }) => g.ACTION_KEY);
    expect(subActive).toContain('WORK_ORDER.UPDATE');

    // 平台把 WORK_ORDER.UPDATE 從廠商手上收回
    const contractorGrants = await (await request.get(`${API}/company/${contractorId}/grant`, { headers })).json();
    const kept = contractorGrants.data.GRANTS.filter((g: { IS_ACTIVE: boolean; ACTION_KEY: string }) => g.IS_ACTIVE)
      .map((g: { ACTION_KEY: string }) => g.ACTION_KEY)
      .filter((a: string) => a !== 'WORK_ORDER.UPDATE');

    const revoke = await (await request.put(`${API}/company/grant`, { headers, data: { COMPANY_ID: contractorId, ACTIONS: kept } })).json();
    expect(revoke.data.CASCADED_REVOKES).toBeGreaterThan(0);

    // 外包那份跟著失效：留著孤兒授權，等於下層還能做上層已經沒有的事
    const after = await (await request.get(`${API}/company/${subId}/grant`, { headers })).json();
    const stillActive = after.data.GRANTS.filter((g: { IS_ACTIVE: boolean }) => g.IS_ACTIVE).map((g: { ACTION_KEY: string }) => g.ACTION_KEY);
    expect(stillActive).not.toContain('WORK_ORDER.UPDATE');

    // 還原，避免影響其他測試
    await request.put(`${API}/company/grant`, { headers, data: { COMPANY_ID: contractorId, ACTIONS: [...kept, 'WORK_ORDER.UPDATE'] } });
    await request.put(`${API}/company/grant`, { headers, data: { COMPANY_ID: subId, ACTIONS: subActive } });
  });
});

/**
 * 下層單位的畫面。
 *
 * API 擋得住不代表畫面對 —— 「開得出來但看不到」與「看得到但開不出來」
 * 都是實際會發生的落差。
 */
test.describe('下層單位管理畫面', () => {
  test('廠商在系統管理看得到自己的外包，並能打開權限矩陣', async ({ page }) => {
    await page.goto('/manage');
    await page.getByRole('tab', { name: '下層單位' }).click();

    await expect(page.getByText('SUB01')).toBeVisible({ timeout: 20_000 });
    // 看不到平台：查詢本身就以子樹收斂
    await expect(page.getByText('ROOT')).toHaveCount(0);

    await page.locator('tbody tr').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('開通權限')).toBeVisible({ timeout: 10_000 });

    // 矩陣只列出自己有的動作 —— 點得到卻開不成是最糟的介面
    await expect(dialog.getByText('派工', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/開通的是/)).toBeVisible();
  });
});
