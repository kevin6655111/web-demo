import { CRACK_LABEL } from '../config/vocabulary';

/**
 * 每日檢查與結算的判斷邏輯。
 *
 * 放在 presenter 而不是元件裡：「這一列算不算異常」「這個數字該紅還是該綠」
 * 都是判斷，而判斷要能單獨測。元件只負責把結果畫出來。
 */

/**
 * 每日檢查的結論分級。
 *
 * 督導只讀 `NOTE` 那一欄，所以那一欄的顏色就是他今天要處理的優先序：
 *
 * - **未出車** 是調度問題，今天就要找人 —— 紅
 * - **有軌跡沒案件** 是判讀模型可能壞了，一整天的資料都會缺 —— 紅
 * - **有案件沒軌跡** 是 GPS 或軌跡上傳的問題，會讓里程結算少算 —— 紅
 * - **照片缺件** 是既成事實，補得回來也補不回來，但不影響今天出車 —— 黃
 *
 * 前三種紅的共同點是「不處理的話明天還會再發生一次」。
 */
const NOTE_RULES = [
  { match: '未出車', level: 'error', action: '確認調度' },
  { match: '沒有案件', level: 'error', action: '檢查判讀模型' },
  { match: '沒有軌跡', level: 'error', action: '檢查車機 GPS' },
  { match: '缺件', level: 'warning', action: '確認照片上傳' }
];

export const SettlementPresenter = {
  /** 一列每日檢查的顯示屬性 */
  checkRow(row) {
    const rule = NOTE_RULES.find((r) => (row.NOTE ?? '').includes(r.match));

    return {
      ...row,
      level: rule?.level ?? 'success',
      action: rule?.action ?? null,
      abnormal: Boolean(rule),
      // 沒有案件時「有幾張照片」不是資訊，顯示成 — 比顯示 0 誠實
      imageText: row.CASE_COUNT ? `${row.IMAGE_TOTAL - row.IMAGE_MISSING}/${row.IMAGE_TOTAL}` : '—',
      trackText: row.TRACK_POINTS ? `${row.TRACK_POINTS} 點` : '無軌跡'
    };
  },

  /** 每日檢查的摘要行；先講結論再給細項 */
  checkSummary(data) {
    const rows = (data?.ROWS ?? []).map((r) => SettlementPresenter.checkRow(r));
    const abnormal = rows.filter((r) => r.abnormal);

    return {
      rows,
      abnormal: abnormal.length,
      total: rows.length,
      // 「全部正常」與「還沒檢查」是兩件完全不同的事，不能都顯示成空白
      verdict: !rows.length ? '這一天還沒有檢查資料' : abnormal.length ? `${abnormal.length} 台需要處理` : '全部正常'
    };
  },

  /**
   * 結算趨勢。
   *
   * 里程與案件畫在同一張圖上：結算爭議幾乎都是
   * 「這個月跑了那麼多公里，怎麼案件這麼少」——
   * 兩條線分開看的話答不了這個問題。
   */
  trendSeries(cases) {
    return (cases ?? []).map((c) => ({
      key: c.GROUP_KEY,
      mileage: Number(c.MILEAGE_KM ?? 0),
      cases: Number(c.CASE_TOTAL ?? 0),
      // 每公里幾件：這是判斷「數字對不對」真正在看的比值
      density: c.MILEAGE_KM ? Number((c.CASE_TOTAL / c.MILEAGE_KM).toFixed(2)) : 0
    }));
  },

  /** 破壞類型的合計；零的類型不畫，圖例才不會塞滿沒有資料的項目 */
  typeTotals(cases) {
    const FIELDS = [
      ['POTHOLE', 'Potholes'],
      ['ALLIGATOR', 'Alligator_Cracking'],
      ['LINEAR', 'Linear_Cracking'],
      ['PATCH', 'Patch_Repair'],
      ['COVER', 'Manhole_Cover'],
      ['OTHER', null]
    ];

    return FIELDS.map(([field, crackKey]) => ({
      key: field,
      label: crackKey ? (CRACK_LABEL[crackKey] ?? field) : '其他',
      value: (cases ?? []).reduce((sum, c) => sum + Number(c[field] ?? 0), 0)
    })).filter((t) => t.value > 0);
  },

  /** 派工進度；逾期單獨拉出來，那是唯一需要有人動作的數字 */
  orderTotals(orders) {
    const sum = (field) => (orders ?? []).reduce((s, o) => s + Number(o[field] ?? 0), 0);

    return {
      dispatched: sum('DISPATCHED'),
      inProgress: sum('IN_PROGRESS'),
      reported: sum('REPORTED'),
      done: sum('DONE'),
      overdue: sum('OVERDUE')
    };
  },

  /** 預設查詢區間：這個月一號到今天 —— 結算是按月請款的 */
  defaultRange() {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);

    return { DATE_START: iso(new Date(today.getFullYear(), today.getMonth(), 1)), DATE_END: iso(today) };
  }
};
