type SwaggerExamples = Record<string, { summary?: string; description?: string; value: unknown }>;

/** [POST maintenance]：建立巡查單的請求範例 */
export const ADD_MAINTENANCE_EXAMPLES: SwaggerExamples = {
  ra: {
    summary: 'RA 巡查（只記錄看到什麼）',
    description: '巡查員在現場開的單，沒有材料與數量',
    value: {
      TYPE: 'RA',
      PRJ_ID: 'DEMO01',
      SURVEY_DATE: '2026-09-01',
      PERIOD: 'AM',
      WEATHER: '晴',
      DTYPE: 'Potholes',
      DEGREE: 'B',
      DTYPE_LENGTH: 1.2,
      DTYPE_WIDTH: 0.8,
      COUNTY: '臺中市',
      DISTRICT: '西屯區',
      CAVLGE: '何厝里',
      ADDRESS: '臺灣大道三段99號',
      LNG: 120.6478,
      LAT: 24.1789,
      REMARK: '積水處，雨後再看一次'
    }
  },
  rb: {
    summary: 'RB 巡修（當場修掉）',
    description: 'RB 必填 MATERIAL —— 修掉了卻沒寫用什麼修，計價時無從對帳',
    value: {
      TYPE: 'RB',
      PRJ_ID: 'DEMO01',
      SURVEY_DATE: '2026-09-01',
      PERIOD: 'PM',
      WEATHER: '陰',
      DTYPE: 'Potholes',
      DEGREE: 'A',
      DTYPE_LENGTH: 0.6,
      DTYPE_WIDTH: 0.5,
      DISTRICT: '北屯區',
      ADDRESS: '中山路一段50號',
      LNG: 120.6812,
      LAT: 24.1901,
      MATERIAL: 'COLD',
      REFILL_LENGTH: 0.7,
      REFILL_WIDTH: 0.6,
      QUANTITY: 3
    }
  }
};

/** [PUT maintenance/status]：批次狀態變更的請求範例 */
export const MAINTENANCE_STATUS_EXAMPLES: SwaggerExamples = {
  watch: { summary: '整批轉為觀察中', value: { ID: [5, 6, 7], STATUS: 1 } },
  remove: {
    summary: '整批刪除',
    description: '有活著的派工單的那幾筆會被跳過，訊息會列出是哪幾筆、為什麼',
    value: { ID: [5, 6], STATUS: -1 }
  },
  restore: {
    summary: '整批復原',
    description: '每筆各自回到歷程上一個不同的狀態；查不到歷程時退回待確認',
    value: { ID: [5, 6], STATUS: 8 }
  }
};
