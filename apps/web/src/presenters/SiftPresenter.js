import { DEGREE_COLOR } from '../config/vocabulary';

/**
 * 二篩畫面的判斷邏輯。
 *
 * 門檻放在這裡而不是元件裡：「準確率低於九成要示警」是業務規則，
 * 寫在 JSX 中間的話，改門檻要去三個地方找。
 */

/** 準確率的門檻：低於這個數字表示判讀品質需要關注 */
const ACCURACY_WARN = 90;
const ACCURACY_BAD = 75;

/**
 * 通過率的合理區間。
 *
 * 上下限都要示警：全部判通過(接近 100%)與全部判誤判(接近 0%)
 * 都表示這個人沒有在看圖，只是在按同一個按鈕。
 */
const PASS_RATE_HIGH = 95;
const PASS_RATE_LOW = 20;

export const SiftPresenter = {
  degreeColor: (degree) => DEGREE_COLOR[degree] ?? 'var(--c-neutral)',

  /** 準確率：越高越好 */
  accuracyColor(value) {
    if (value >= ACCURACY_WARN) return 'var(--c-success)';
    if (value >= ACCURACY_BAD) return 'var(--c-warning)';
    return 'var(--c-error)';
  },

  /** 通過率：兩端都可疑，中間才正常 */
  passRateColor(value) {
    if (value >= PASS_RATE_HIGH || value <= PASS_RATE_LOW) return 'var(--c-warning)';
    return 'var(--c-info)';
  },

  /** 一列薪資的說明文字；報表與畫面用同一句 */
  payNote(row) {
    if (!row?.JUDGED) return '本月無判定紀錄';
    if (!row.OVERTURNED) return `判定 ${row.JUDGED} 件，無誤判`;

    return `判定 ${row.JUDGED} 件，其中 ${row.OVERTURNED} 件經覆核為誤判`;
  }
};
