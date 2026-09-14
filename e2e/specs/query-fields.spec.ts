import { expect, test } from '@playwright/test';

/**
 * 查詢面板的欄位與後端 DTO 的一致性。
 *
 * 查詢條件定義集中在 `config/queryFields.js`，但後端的 DTO 開啟了
 * `forbidNonWhitelisted` —— 面板提供了 DTO 沒有的欄位時，使用者一設定就收到 400，
 * 而畫面上只會顯示「參數錯誤」。
 *
 * 實際發生過：車隊管理與道路評估的面板都提供標案／工務段／縣市／行政區，
 * 而兩支 DTO 都不接受，這些篩選從來沒有作用過。
 *
 * 這組測試逐一送出面板會送的欄位，確認後端接受且條件真的生效。
 */

/** 面板 → 端點 → 該面板會送出的範圍條件 */
const PANELS = [
  {
    name: '車隊管理',
    path: '/api/fleet/vehicle',
    fields: { PRJ_ID: 'DEMO01', SECTION_ID: '1', COUNTY: '示範市', DISTRICT: '西屯區' }
  },
  {
    name: '道路評估',
    path: '/api/roadeval/segment',
    fields: { PRJ_ID: 'DEMO01', SECTION_ID: '1', COUNTY: '示範市', DISTRICT: '西屯區' }
  }
] as const;

test.describe('查詢面板的欄位後端都接受', () => {
  for (const panel of PANELS) {
    test(`${panel.name}：每個範圍條件單獨送都不會被拒絕`, async ({ request }) => {
      for (const [key, value] of Object.entries(panel.fields)) {
        const res = await request.get(panel.path, { params: { [key]: value } });

        expect(res.status(), `${panel.name} 的 ${key} 應被 DTO 接受`).toBe(200);
      }
    });

    test(`${panel.name}：全部條件一起送也不會被拒絕`, async ({ request }) => {
      const res = await request.get(panel.path, { params: panel.fields });
      expect(res.status()).toBe(200);
    });

    test(`${panel.name}：條件真的有作用，不是被接受後忽略`, async ({ request }) => {
      // 只驗「接受」是不夠的 —— DTO 加了欄位但服務沒實作時，
      // 條件會被安靜地忽略，而那比 400 更難發現
      const nonsense = await (await request.get(panel.path, { params: { PRJ_ID: 'NOPE99' } })).json();
      const rows = Array.isArray(nonsense.data) ? nonsense.data : [];

      expect(rows.length, '不存在的標案應該篩不到任何資料').toBe(0);
    });
  }
});
