/**
 * 道路設定的中文與顏色。
 *
 * 這些代碼表在 `@road-patrol/shared` 有定義，但那份定義是給**後端驗證**用的；
 * 前端要的是「下拉選單的選項陣列」與「這個值該顯示什麼顏色」——
 * 兩者的形狀不同，硬要共用會讓 shared 開始長出 UI 的東西。
 */

const JURISDICTION = {
  CITY: { label: '市府', color: 'var(--c-info)' },
  TOWNSHIP: { label: '公所', color: 'var(--c-warning)' },
  HIGHWAY: { label: '公路單位', color: 'var(--c-muted)' },
  OTHER: { label: '其他', color: 'var(--c-neutral)' }
};

const BLOCK_TYPE = {
  MAIN: '主要道路',
  SECONDARY: '次要道路',
  LANE: '巷弄',
  EXPRESS: '快速道路'
};

const BLOCK_STATUS = {
  0: { label: '未設定', color: 'var(--c-neutral)' },
  1: { label: '納入巡查', color: 'var(--c-success)' },
  2: { label: '不納入', color: 'var(--c-muted)' },
  3: { label: '施工中', color: 'var(--c-warning)' }
};

/** 覆蓋率的履約門檻：低於這個數字在驗收時會被扣款 */
const COVERAGE_TARGET = 80;
const COVERAGE_POOR = 50;

export const RoadSettingPresenter = {
  jurisdictionLabel: (v) => JURISDICTION[v]?.label ?? v,
  jurisdictionColor: (v) => JURISDICTION[v]?.color ?? 'var(--c-neutral)',
  jurisdictionOptions: () => Object.entries(JURISDICTION).map(([value, v]) => ({ value, label: v.label })),

  blockTypeLabel: (v) => BLOCK_TYPE[v] ?? v,
  blockTypeOptions: () => Object.entries(BLOCK_TYPE).map(([value, label]) => ({ value, label })),

  blockStatusLabel: (v) => BLOCK_STATUS[v]?.label ?? String(v),
  blockStatusColor: (v) => BLOCK_STATUS[v]?.color ?? 'var(--c-neutral)',
  blockStatusOptions: () => Object.entries(BLOCK_STATUS).map(([value, v]) => ({ value: Number(value), label: v.label })),

  /** 覆蓋率的顏色：達標、落後、明顯有問題 */
  coverageColor(value) {
    if (value >= COVERAGE_TARGET) return 'var(--c-success)';
    if (value >= COVERAGE_POOR) return 'var(--c-warning)';
    return 'var(--c-error)';
  },

  /** 線段在地圖上的顏色：排除的要看得出來是排除的 */
  lineColor(properties) {
    if (!properties?.isActive) return 'var(--c-neutral)';
    return JURISDICTION[properties.jurisdiction]?.color ?? 'var(--c-info)';
  }
};
