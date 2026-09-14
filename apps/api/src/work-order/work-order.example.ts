type SwaggerExamples = Record<string, { summary?: string; description?: string; value: unknown }>;

/** [POST workorder]：建立派工單的請求範例 */
export const ADD_ORDER_EXAMPLES: SwaggerExamples = {
  pa: {
    summary: 'PA 刨除加封',
    description: '自行發起的工程，起訖點各一組座標與地址',
    value: {
      TYPE: 'PA',
      PRJ_ID: 'DEMO01',
      COUNTY: '臺中市',
      DISTRICT: '西屯區',
      CAVLGE: '何厝里',
      ADDRESS: '臺灣大道三段99號',
      DISPATCH_DATE: '2026-08-29',
      DUE_DATE: '2026-09-05',
      WORKER_USER_ID: 4,
      MATERIAL: 'AC',
      MATERIAL_SIZE: 12.5,
      WORK_LENGTH: 10.5,
      WORK_WIDTH: 3.2,
      WORK_DEPTH_MILLING: 5,
      WORK_DEPTH_PAVING: 5,
      START_LNG: 120.6478,
      START_LAT: 24.1789,
      END_LNG: 120.6501,
      END_LAT: 24.1802,
      START_ADDR: '臺灣大道三段99號',
      END_ADDR: '臺灣大道三段199號'
    }
  },
  pb: {
    summary: 'PB 路基改善（必填取樣）',
    description: 'PB 一定要帶 SAMPLE_TAKEN；有取樣時還要 SAMPLE_DATE 與 TEST_ITEM',
    value: {
      TYPE: 'PB',
      PRJ_ID: 'DEMO01',
      DISTRICT: '西屯區',
      ADDRESS: '文心路四段200號',
      DISPATCH_DATE: '2026-08-29',
      MATERIAL: 'CC',
      SAMPLE_TAKEN: true,
      SAMPLE_DATE: '2026-09-01',
      TEST_ITEM: ['壓實度', '厚度']
    }
  },
  pc: {
    summary: 'PC 由車巡案件轉派',
    description: 'PC 必須帶來源案件 id，否則會出現「修了但不知道在修什麼」的單',
    value: {
      TYPE: 'PC',
      PRJ_ID: 'DEMO01',
      DISTRICT: '北屯區',
      ADDRESS: '中山路一段50號',
      DISPATCH_DATE: '2026-08-29',
      DUE_DATE: '2026-09-02',
      WORKER_USER_ID: 5,
      CASE_PATROL_ID: 1024,
      MATERIAL: 'COLD'
    }
  }
};

/** [PUT workorder/status]：狀態變更的請求範例 */
export const UPDATE_STATUS_EXAMPLES: SwaggerExamples = {
  start: { summary: '開始施工', value: { ID: 3, STATUS: 1 } },
  report: { summary: '回報完工', description: '照片要在此之前上傳', value: { ID: 3, STATUS: 2 } },
  finish: { summary: '驗收完工', description: '會檢查必要照片是否齊全', value: { ID: 3, STATUS: 3 } },
  reject: {
    summary: '退回重做',
    description: '設回待處理並填退回原因；來源案件回到「觀察中」',
    value: { ID: 3, STATUS: 0, REJECT_REASON: '邊緣未壓實' }
  }
};
