/**
 * 報表畫面的判斷邏輯。
 *
 * 「哪一種報表要顯示哪些欄位」由後端的 `REPORT_KIND_DEF.PARAMS` 決定，
 * 這裡只負責把參數群組翻譯成表單欄位 —— 群組名稱與欄位長相的對應
 * 是前端的事，後端不該知道「DATE 要畫成兩個日期輸入框」。
 */

const STATE = {
  PENDING: { label: '排隊中', color: 'default' },
  RUNNING: { label: '產製中', color: 'info' },
  DONE: { label: '完成', color: 'success' },
  FAILED: { label: '失敗', color: 'error' }
};

const GROUP_LABEL = { PATROL: '車巡', SIFT: '二篩', SURVEY: '鋪面調查' };

export const ReportPresenter = {
  stateLabel: (s) => STATE[s]?.label ?? s,
  stateColor: (s) => STATE[s]?.color ?? 'default',
  groupLabel: (g) => GROUP_LABEL[g] ?? g,

  /**
   * 參數群組 → 查詢表單的欄位。
   *
   * 需要選項的群組(標案、車輛、判讀員、委託單)由呼叫端把清單傳進來 ——
   * 這個函式不去抓資料，否則它就變成一個會發請求的 presenter。
   */
  paramFields(groups = [], options = {}) {
    const { projects = [], vehicles = [], users = [], orders = [], districts = [], crackTypes = [], levels = [] } =
      options;

    const MAP = {
      DATE: [
        { key: 'DATE_FROM', label: '起日', type: 'date' },
        { key: 'DATE_TO', label: '迄日', type: 'date' }
      ],
      DAY: [{ key: 'DAY', label: '日期', type: 'date', required: true }],
      MONTH: [{ key: 'MONTH', label: '月份', type: 'month', required: true, width: 150 }],
      PRJ_ID: [
        {
          key: 'PRJ_ID',
          label: '標案',
          type: 'select',
          width: 200,
          options: projects.map((p) => ({ value: p.PRJ_ID, label: `${p.PRJ_ID} ${p.PRJ_NAME}` }))
        }
      ],
      COUNTY: [{ key: 'COUNTY', label: '縣市', width: 120 }],
      DISTRICT: [
        {
          key: 'DISTRICT',
          label: '行政區',
          type: 'select',
          options: districts.map((d) => ({ value: d.DISTRICT, label: d.DISTRICT }))
        }
      ],
      VEHICLE_ID: [
        {
          key: 'VEHICLE_ID',
          label: '車輛',
          type: 'select',
          options: vehicles.map((v) => ({ value: v.ID, label: v.PLATE_NO }))
        }
      ],
      USER_ID: [
        {
          key: 'USER_ID',
          label: '判讀員',
          type: 'select',
          options: users.map((u) => ({ value: u.ID, label: u.USER_NAME }))
        }
      ],
      ORDER_ID: [
        {
          key: 'ORDER_ID',
          label: '委託單',
          type: 'select',
          width: 240,
          required: true,
          options: orders.map((o) => ({ value: o.ID, label: `${o.ORDER_NO} ${o.TITLE}` }))
        }
      ],
      STATUS: [
        {
          key: 'STATUS',
          label: '二篩狀態',
          type: 'select',
          options: [
            { value: 0, label: '未審' },
            { value: 1, label: '通過' },
            { value: 2, label: '待審' },
            { value: 4, label: '誤判' }
          ]
        }
      ],
      NEED_REPAIR: [
        {
          key: 'NEED_REPAIR',
          label: '修繕狀態',
          type: 'select',
          options: [
            { value: 0, label: '待確認' },
            { value: 1, label: '觀察中' },
            { value: 2, label: '已派工' }
          ]
        }
      ],
      CRACK_TYPE: [
        {
          key: 'CRACK_TYPE',
          label: '破壞類型',
          type: 'select',
          options: crackTypes.map(([value, label]) => ({ value, label }))
        }
      ],
      MAINTAIN_LEVEL: [
        {
          key: 'MAINTAIN_LEVEL',
          label: '養護等級',
          type: 'select',
          options: levels.map(([value, label]) => ({ value, label }))
        }
      ]
    };

    return groups.flatMap((g) => MAP[g] ?? []);
  },

  /** 條件摘要：清單上要看得出「這份報表是用什麼條件產的」 */
  paramSummary(params) {
    if (!params) return '';

    const entries = Object.entries(params).filter(([, v]) => v !== null && v !== '' && v !== undefined);
    if (!entries.length) return '無條件（全部）';

    return entries.map(([k, v]) => `${k}=${v}`).join(' · ');
  }
};
