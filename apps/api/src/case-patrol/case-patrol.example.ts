type SwaggerExamples = Record<string, { summary?: string; description?: string; value: unknown }>;

/** [POST patrol/case]：新增案件的請求範例 */
export const ADD_CASE_EXAMPLES: SwaggerExamples = {
  vehicle: {
    summary: '車機自動偵測',
    description: [
      '車巡系統辨識出破壞後上傳。',
      '',
      '去重的鍵是 `DT_RECORD` + `IMG_DETECT` + `CRACK_ID` ——',
      '同一張判讀圖上的同一個破壞，重送多少次都只會有一筆。',
      '車機在隧道裡收不到回應就重送，這是常態而不是例外。'
    ].join('\n'),
    value: {
      DT_RECORD: '2026-08-28T09:12:00.123+08:00',
      PRJ_ID: 'DEMO01',
      CAR: 'DEMO-001',
      LNG: 120.6478,
      LAT: 24.1636,
      ALTITUDE: 92.4,
      CRACK_TYPE: 'Potholes',
      DEGREE: 'A',
      CRACK_ID: 1,
      LENGTH: 0.7,
      WIDTH: 0.5,
      AREA: 0.35,
      DEPTH: 8,
      IMG: 'demo/case/TXG-20260828-000123.jpg',
      IMG_DETECT: 'demo/case/TXG-20260828-000123_detect.jpg',
      SERIAL_NO: 123,
      PATH: 'demo/path/DEMO-001/2026-08-28.json'
    }
  },
  app: {
    summary: 'APP 巡查回報',
    description: '巡查員以手機回報；沒有判讀圖，去重改由 `EXTERNAL_ID` 的唯一鍵擋下',
    value: {
      EXTERNAL_ID: 'APP-20260828-0007',
      DT_RECORD: '2026-08-28T14:30:00.000+08:00',
      PRJ_ID: 'DEMO01',
      LNG: 120.652,
      LAT: 24.158,
      CRACK_TYPE: 'Cracking',
      DEGREE: 'B',
      LENGTH: 2.4,
      WIDTH: 0.5,
      AREA: 1.2
    }
  }
};

/** [PUT patrol/case/status]：狀態變更的請求範例 */
export const UPDATE_STATUS_EXAMPLES: SwaggerExamples = {
  pass: { summary: '二篩通過', description: '通過二篩的案件才會進入修繕流程', value: { ID: 12, STATUS: 1 } },
  misjudge: {
    summary: '判定為誤判',
    description: 'AI 判讀有誤；誤判與刪除分開記，模型調校時要分得出來',
    value: { ID: 12, STATUS: 4 }
  },
  needRepair: { summary: '判定需修繕', value: { ID: 12, NEED_REPAIR: 1 } },
  review: {
    summary: '主管複審',
    description: '帶 `AS_ADMIN` 會記在複審欄位而不是覆蓋二篩人員',
    value: { ID: 12, STATUS: 1, AS_ADMIN: true }
  }
};
