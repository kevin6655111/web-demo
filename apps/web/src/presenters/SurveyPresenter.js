import { SURVEY_ORDER_STATE_LABEL } from '../config/vocabulary';

/** 調查點狀態的中文與顏色；`DELETED` 不是狀態而是刪除旗標，所以不在這裡 */
const CASE_STATE = {
  PENDING: { label: '待調查', color: 'var(--c-warning)' },
  DONE: { label: '已完成', color: 'var(--c-success)' },
  REJECTED: { label: '不予採計', color: 'var(--c-muted)' }
};

const DIRECTION = { BOTH: '雙向', FORWARD: '順向', BACKWARD: '逆向' };
const SOURCE = { WEB: '網頁排點', APP: 'App 現場', DEVICE: '車機匯入' };

/**
 * PCI 的門檻。
 *
 * 與 `road-eval` 的養護等級同一套刻度 —— 兩邊用不同門檻的話，
 * 同一段路在調查頁顯示「尚可」而在地圖上是「不良」。
 */
const PCI_GOOD = 70;
const PCI_FAIR = 55;
const PCI_POOR = 40;

export const SurveyPresenter = {
  caseStateLabel: (state) => CASE_STATE[state]?.label ?? state,
  caseStateColor: (state) => CASE_STATE[state]?.color ?? 'var(--c-neutral)',
  directionLabel: (d) => DIRECTION[d] ?? d,
  sourceLabel: (s) => SOURCE[s] ?? s,
  orderStateLabel: (s) => SURVEY_ORDER_STATE_LABEL[s] ?? s,

  /** 委託單狀態：結案是終點，其餘都還在進行 */
  orderStateColor(state) {
    if (state === 'CLOSED') return 'var(--c-success)';
    if (state === 'DRAFT') return 'var(--c-neutral)';
    return 'var(--c-info)';
  },

  /** 進度條的顏色：落後才需要被看見 */
  progressColor(value) {
    if (value >= 100) return 'var(--c-success)';
    if (value >= 50) return 'var(--c-info)';
    return 'var(--c-warning)';
  },

  pciColor(value) {
    if (value === null || value === undefined) return 'var(--c-neutral)';
    if (value >= PCI_GOOD) return 'var(--c-success)';
    if (value >= PCI_FAIR) return 'var(--c-warning)';
    if (value >= PCI_POOR) return 'var(--c-muted)';
    return 'var(--c-error)';
  },

  /** 樁號：後端已經組好字串，這裡只處理沒有樁號的情況 */
  station: (value) => value ?? '—'
};
