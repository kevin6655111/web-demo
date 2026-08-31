/**
 * 照片類型。
 *
 * 派工單的每一張照片都有固定類型 —— 驗收時要對照「施工前／中／後」，
 * 缺哪一張是明確的事實，而不是承辦憑印象判斷。
 *
 * ZIP 類型給批次上傳用：現場一次拍幾十張，一張一張傳在工地的網路下不切實際。
 */
export const IMAGE_TYPE_DEF = [
  { type: 'IMG', name: '巡查', zip: false },
  { type: 'IMG_BEFORE', name: '施工前', zip: false },
  { type: 'IMG_DURING', name: '施工中', zip: false },
  { type: 'IMG_AFTER', name: '施工後', zip: false },
  { type: 'IMG_MILLING_DURING', name: '刨除中', zip: false },
  { type: 'IMG_MILLING_ALTER', name: '刨除後', zip: false },
  { type: 'IMG_MILLING_THICKNESS', name: '刨除厚度檢測', zip: false },
  { type: 'IMG_CEMENT_PAVING', name: '水泥鋪設', zip: false },
  { type: 'IMG_SUBGRADE_REHAB', name: '路基翻修乾拌水泥', zip: false },
  { type: 'IMG_PLATE_DEPTH_CHECK', name: '平台深度檢測', zip: false },
  { type: 'IMG_VIBRATION_MACHINE', name: '震動機壓實路面', zip: false },
  { type: 'IMG_COMPACTION_TEST', name: '壓實度檢測', zip: false },
  { type: 'IMG_COAT_SPRAYING', name: '透層噴灑', zip: false },
  { type: 'IMG_FIRST_PAVING', name: '底層鋪築-初次鋪設', zip: false },
  { type: 'IMG_TRIPLE_ROLLER', name: '三輪鋼輪機-初壓', zip: false },
  { type: 'IMG_FIRST_THICKNESS_CHECK', name: '第一次鋪築厚度檢測', zip: false },
  { type: 'IMG_SURFACE_PAVING', name: '鋪設面層', zip: false },
  { type: 'IMG_SECOND_SURFACE_PAVING', name: '面層鋪築-二次鋪設', zip: false },
  { type: 'IMG_SURFACE_DEPTH', name: '路面深度', zip: false },
  { type: 'IMG_AC_SAMPLING', name: 'AC 取樣', zip: false },
  { type: 'IMG_BEFORE_ZIP', name: '施工前(壓縮檔)', zip: true },
  { type: 'IMG_DURING_ZIP', name: '施工中(壓縮檔)', zip: true },
  { type: 'IMG_AFTER_ZIP', name: '施工後(壓縮檔)', zip: true },
  { type: 'IMG_MILLING_AFTER_ZIP', name: '刨除後(壓縮檔)', zip: true },
  { type: 'IMG_SAMPLE_ZIP', name: '取樣照片(壓縮檔)', zip: true },
  { type: 'IMG_OTHER_ZIP', name: '其它照片(壓縮檔)', zip: true }
] as const;

export type ImageType = (typeof IMAGE_TYPE_DEF)[number]['type'];

/** 依派工單類型決定要求哪些照片；驗收畫面用它標示「缺哪張」 */
export const REQUIRED_IMAGES: Record<string, string[]> = {
  PA: ['IMG_BEFORE', 'IMG_MILLING_ALTER', 'IMG_SURFACE_PAVING', 'IMG_AFTER'],
  PB: ['IMG_BEFORE', 'IMG_SUBGRADE_REHAB', 'IMG_COMPACTION_TEST', 'IMG_AFTER'],
  PC: ['IMG_BEFORE', 'IMG_AFTER'],
  PD: ['IMG_BEFORE', 'IMG_AFTER']
};

/**
 * 派工單表單上的照片分區。
 *
 * 「哪些照片、擺在哪一區、標題叫什麼」是表單排版的一部分，
 * 而排版會跟著業主的驗收要求改。放在這裡而不是寫死在前端元件裡，
 * 前後端才會用同一份定義 —— 否則報表檢查的是一份清單、畫面顯示的是另一份。
 *
 * PA/PB 是自行發起的工程，照片多且要留全部(ZIP)；
 * PC/PD 由巡查案件轉來，現場只需要施工前中後三張。
 */
export const IMAGE_GROUPS: Record<string, { group: string; types: string[] }[]> = {
  PA: [
    { group: '施工照片', types: ['IMG_BEFORE_ZIP', 'IMG_DURING_ZIP', 'IMG_AFTER_ZIP', 'IMG_MILLING_AFTER_ZIP'] },
    { group: '施工照片(其它)', types: ['IMG_OTHER_ZIP'] }
  ],
  PB: [
    {
      group: '施工照片',
      types: [
        'IMG_BEFORE',
        'IMG_MILLING_DURING',
        'IMG_AFTER',
        'IMG_MILLING_THICKNESS',
        'IMG_CEMENT_PAVING',
        'IMG_SUBGRADE_REHAB',
        'IMG_PLATE_DEPTH_CHECK',
        'IMG_VIBRATION_MACHINE',
        'IMG_COMPACTION_TEST',
        'IMG_COAT_SPRAYING',
        'IMG_FIRST_PAVING',
        'IMG_TRIPLE_ROLLER',
        'IMG_FIRST_THICKNESS_CHECK',
        'IMG_SURFACE_PAVING',
        'IMG_SECOND_SURFACE_PAVING',
        'IMG_SURFACE_DEPTH',
        'IMG_AC_SAMPLING'
      ]
    },
    { group: '取樣圖片', types: ['IMG_SAMPLE_ZIP'] },
    { group: '施工照片(其它)', types: ['IMG_OTHER_ZIP'] }
  ],
  PC: [
    { group: '回填照片', types: ['IMG_BEFORE', 'IMG_DURING', 'IMG_AFTER'] },
    { group: '施工照片(其它)', types: ['IMG_OTHER_ZIP'] }
  ],
  PD: [
    { group: '回填照片', types: ['IMG_BEFORE', 'IMG_DURING', 'IMG_AFTER'] },
    { group: '施工照片(其它)', types: ['IMG_OTHER_ZIP'] }
  ]
};

/**
 * 破壞分類。
 *
 * 依縣市不同 —— 同一種破壞，臺北叫「人手孔缺失」，其他縣市叫「人手孔蓋未平順」。
 * 報表要交給業主，用錯名稱會被退件。
 */
export const CRACK_TYPE_DEF = [
  { key: 'Cover', name: '人手孔蓋未平順', nameTaipei: '人手孔缺失' },
  { key: 'Potholes', name: '坑洞', nameTaipei: '坑洞' },
  { key: 'Patch', name: '補綻', nameTaipei: '補綻' },
  { key: 'Cracking', name: '線狀裂縫', nameTaipei: '縱向及橫向裂縫' },
  { key: 'Alligator_Cracking', name: '鱷魚狀裂縫', nameTaipei: '龜裂' },
  { key: 'Rutting', name: '車轍', nameTaipei: '車轍' },
  { key: 'Subsidence', name: '路基下陷', nameTaipei: '路基下陷' }
] as const;

export type CrackTypeKey = (typeof CRACK_TYPE_DEF)[number]['key'];

/** 破壞程度：A 最嚴重 */
export const DEGREE_DEF = [
  { key: 'A', name: '嚴重' },
  { key: 'B', name: '中等' },
  { key: 'C', name: '輕微' }
] as const;

/**
 * 派工單類型。
 *
 * 前兩種是自行發起的工程，後兩種從既有案件轉來 ——
 * 所以 PC/PD 建立時必須帶來源案件 id，否則會出現「修了但不知道在修什麼」的單。
 */
export const WORK_ORDER_TYPE_DEF = [
  { key: 'PA', name: '刨除加封', needSource: null },
  { key: 'PB', name: '路基改善', needSource: null },
  { key: 'PC', name: 'AI 車巡', needSource: 'CASE_PATROL_ID' },
  { key: 'PD', name: 'APP 巡查', needSource: 'MAINTENANCE_ID' }
] as const;

/** 派工單狀態 */
export const WORK_ORDER_STATUS_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '待處理', color: 'secondary' },
  { value: 1, name: '施工中', color: 'warning' },
  { value: 2, name: '已回報', color: 'info' },
  { value: 3, name: '已完工', color: 'success' }
] as const;

/**
 * 檢測案件狀態。
 */
export const SURVEY_STATUS_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '未檢查', color: 'warning' },
  { value: 1, name: '已檢查', color: 'success' }
] as const;

/**
 * 派工單的狀態「動作碼」。
 *
 * 這些不是會被存下來的狀態，而是送給 API 的指令 ——
 * 撤回是把單退回上一步、復原是把已刪除的單救回來。
 * 與狀態值混在同一個列舉裡的話，資料庫會出現 `status = 9` 這種不存在的狀態。
 */
export const WORK_ORDER_ACTION = {
  RESTORE: 8,
  WITHDRAW: 9
} as const;

/**
 * 車巡案件的三組狀態。
 *
 * 拆成三組而不是一個欄位，因為它們是三個獨立的判斷、由不同的人在不同時間做：
 *   status      二篩結果 —— 這是不是真的破壞
 *   edited      有沒有被人工修改過 —— 稽核用
 *   needRepair  要不要修 —— 養護判斷，跟「是不是破壞」是兩回事
 */
export const CASE_STATUS_DEF = [
  { value: 0, name: '未審', color: 'default' },
  { value: 1, name: '通過', color: 'success' },
  { value: 2, name: '待審', color: 'warning' },
  { value: 3, name: '刪除', color: 'default' },
  { value: 4, name: '誤判', color: 'error' }
] as const;

export const CASE_EDITED_DEF = [
  { value: 0, name: '未編輯' },
  { value: 1, name: '已編輯' },
  { value: 2, name: '刪除' }
] as const;

export const NEED_REPAIR_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '待確認', color: 'warning' },
  { value: 1, name: '觀察中', color: 'info' },
  { value: 2, name: '已派工', color: 'success' }
] as const;

/** 施工材料 */
export const MATERIAL_DEF = [
  { key: 'AC', name: '瀝青混凝土' },
  { key: 'CC', name: '水泥混凝土' },
  { key: 'COLD', name: '冷拌瀝青' },
  { key: 'SEAL', name: '填縫料' }
] as const;

/** 試驗項目(路基改善取樣後要做的) */
export const TEST_ITEM_DEF = ['壓實度', '厚度', '瀝青含量', '篩分析', '平坦度'] as const;

/** 調查時段與天氣：巡查單的必填欄位，影響判定基準 */
export const PERIOD_DEF = [
  { key: 'AM', name: '上午' },
  { key: 'PM', name: '下午' }
] as const;

export const WEATHER_DEF = [
  { key: '晴', name: '晴' },
  { key: '陰', name: '陰' },
  { key: '雨', name: '雨' }
] as const;
