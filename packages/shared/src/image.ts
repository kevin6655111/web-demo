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
