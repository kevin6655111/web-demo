import { CRACK_LABEL, NEED_REPAIR_COLOR } from '../config/vocabulary';

/**
 * 儀表板的資料整形。
 *
 * 抽出來的理由是「畫面不該做決策」：
 * 顏色怎麼配、逾期算幾天、趨勢圖要不要補零 —— 這些是規則，不是渲染。
 * 規則放在這裡，元件就只剩下畫圖，測試也不必掛著 DOM 跑。
 */
export const DashboardPresenter = {
  /** KPI 卡片：標題、數值、單位、色調、說明 */
  kpiCards(kpi) {
    if (!kpi) return [];

    return [
      // 給主題色鍵而不是色碼：卡片會對顏色做透明度運算，
      // 而那需要真正的色值 —— 由 KpiCard 從主題解析出當前佈景的那一個
      { key: 'TODAY', label: '今日新增', value: kpi.TODAY, unit: '件', tone: 'info', hint: '今天進來的案件數' },
      { key: 'PENDING', label: '待派工', value: kpi.PENDING, unit: '件', tone: 'warning', hint: '待確認與觀察中的案件' },
      { key: 'REPAIR_RATE', label: '完修率', value: kpi.REPAIR_RATE, unit: '%', tone: 'success', hint: '派工單已完工 ÷ 全部案件' },
      {
        key: 'AVG_REPAIR_HOURS',
        label: '平均修復',
        value: kpi.AVG_REPAIR_HOURS ?? 0,
        unit: '小時',
        tone: 'secondary',
        hint: '從案件被拍到，到派工單完工驗收的平均時間'
      }
    ];
  },

  /** 趨勢圖資料 */
  trendSeries(trend = []) {
    return trend.map((t) => ({ day: t.DAY, 案件: t.TOTAL, 完修: t.REPAIRED }));
  },

  /**
   * 類型分布：中文標籤 + 固定色盤。
   *
   * 這裡用真實色碼而不是 CSS 變數 —— Recharts 會把 fill 拿去算圖例的色塊，
   * 拿到 `var(...)` 時算不出東西，圖例會變成透明。
   */
  typeSeries(byType = [], mode = 'dark') {
    const palette =
      mode === 'light'
        ? ['#0284c7', '#7c3aed', '#b45309', '#059669', '#dc2626']
        : ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f87171'];

    return byType.map((t, i) => ({
      name: CRACK_LABEL[t.TYPE] ?? t.TYPE,
      value: t.COUNT,
      area: t.AREA,
      fill: palette[i % palette.length]
    }));
  },

  /** 熱區：附上相對比例，讓長條圖不必再算一次 */
  hotspots(rows = []) {
    const max = Math.max(1, ...rows.map((r) => r.COUNT));
    return rows.map((r) => ({ ...r, RATIO: r.COUNT / max }));
  },

  /** 逾期單：把小時換成人看得懂的說法 */
  overdue(rows = []) {
    return rows.map((r) => {
      const hours = Math.round(Number(r.OVERDUE_HOURS ?? 0));
      const days = Math.floor(hours / 24);

      return { ...r, OVERDUE_TEXT: days >= 1 ? `逾期 ${days} 天` : `逾期 ${hours} 小時`, SEVERE: days >= 3 };
    });
  },

  /** 修繕狀態對應的顏色；看板與地圖看的都是「修了沒」 */
  statusColor(needRepair) {
    return NEED_REPAIR_COLOR[needRepair] ?? 'var(--c-neutral)';
  },

  /**
   * 把 WebSocket 推來的新案件併進即時清單。
   * 去重是必要的：重連後可能收到已經在清單裡的案件。
   */
  mergeIncoming(list, incoming, limit = 12) {
    if (list.some((c) => c.ID === incoming.caseId)) return list;

    const row = {
      ID: incoming.caseId,
      CASE_NUM: incoming.caseNum ?? null,
      EXTERNAL_ID: incoming.externalId,
      CRACK_TYPE: incoming.crackType,
      DEGREE: incoming.degree ?? null,
      // 剛進來的案件還沒二篩也還沒判定要不要修
      STATUS: 0,
      NEED_REPAIR: 0,
      ROAD_NAME: null,
      DT_RECORD: incoming.detectedAt,
      LNG: incoming.lng,
      LAT: incoming.lat,
      IS_NEW: true
    };

    return [row, ...list].slice(0, limit);
  }
};
