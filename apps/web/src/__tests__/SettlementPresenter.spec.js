import { describe, expect, it } from 'vitest';
import { SettlementPresenter } from '../presenters/SettlementPresenter';

describe('SettlementPresenter.checkRow', () => {
  it('未出車是紅的 —— 那是今天就要找人處理的調度問題', () => {
    const row = SettlementPresenter.checkRow({ NOTE: '未出車', CASE_COUNT: 0, IMAGE_TOTAL: 0, TRACK_POINTS: 0 });

    expect(row.level).toBe('error');
    expect(row.abnormal).toBe(true);
    expect(row.action).toBe('確認調度');
  });

  it('有案件沒軌跡也是紅的 —— 那會讓這台車的里程結算少算', () => {
    const row = SettlementPresenter.checkRow({
      NOTE: '有案件但沒有軌跡，請確認車機 GPS 與軌跡上傳',
      CASE_COUNT: 5,
      IMAGE_TOTAL: 5,
      IMAGE_MISSING: 0,
      TRACK_POINTS: 0
    });

    expect(row.level).toBe('error');
    expect(row.trackText).toBe('無軌跡');
  });

  it('照片缺件只是黃的 —— 補不回來但不影響今天出車', () => {
    const row = SettlementPresenter.checkRow({
      NOTE: '照片可能缺件約 3 張',
      CASE_COUNT: 10,
      IMAGE_TOTAL: 10,
      IMAGE_MISSING: 3,
      TRACK_POINTS: 300
    });

    expect(row.level).toBe('warning');
    expect(row.imageText).toBe('7/10');
  });

  it('沒有案件時照片欄顯示 — 而不是 0/0', () => {
    const row = SettlementPresenter.checkRow({ NOTE: '未出車', CASE_COUNT: 0, IMAGE_TOTAL: 0, TRACK_POINTS: 0 });
    expect(row.imageText).toBe('—');
  });
});

describe('SettlementPresenter.checkSummary', () => {
  it('「全部正常」與「還沒檢查」是兩件事，不能都顯示成空白', () => {
    expect(SettlementPresenter.checkSummary({ ROWS: [] }).verdict).toBe('這一天還沒有檢查資料');
    expect(SettlementPresenter.checkSummary({ ROWS: [{ NOTE: '正常', CASE_COUNT: 1 }] }).verdict).toBe('全部正常');
  });

  it('有異常時直接說幾台要處理', () => {
    const summary = SettlementPresenter.checkSummary({
      ROWS: [{ NOTE: '正常', CASE_COUNT: 1 }, { NOTE: '未出車', CASE_COUNT: 0 }, { NOTE: '未出車', CASE_COUNT: 0 }]
    });

    expect(summary.abnormal).toBe(2);
    expect(summary.verdict).toBe('2 台需要處理');
  });
});

describe('SettlementPresenter.trendSeries', () => {
  it('算出每公里幾件 —— 結算爭議看的是這個比值，不是兩個絕對數字', () => {
    const [row] = SettlementPresenter.trendSeries([{ GROUP_KEY: '2026-09-01', MILEAGE_KM: 100, CASE_TOTAL: 25 }]);
    expect(row.density).toBe(0.25);
  });

  it('里程為零時不會除出 Infinity', () => {
    const [row] = SettlementPresenter.trendSeries([{ GROUP_KEY: '2026-09-01', MILEAGE_KM: 0, CASE_TOTAL: 3 }]);
    expect(row.density).toBe(0);
  });
});

describe('SettlementPresenter.typeTotals', () => {
  it('零的類型不畫 —— 圖例塞滿沒有資料的項目會蓋掉真正有的那幾個', () => {
    const totals = SettlementPresenter.typeTotals([
      { POTHOLE: 3, ALLIGATOR: 0, LINEAR: 0, PATCH: 0, COVER: 0, OTHER: 0 },
      { POTHOLE: 2, ALLIGATOR: 1, LINEAR: 0, PATCH: 0, COVER: 0, OTHER: 0 }
    ]);

    expect(totals.map((t) => t.key)).toEqual(['POTHOLE', 'ALLIGATOR']);
    expect(totals[0].value).toBe(5);
  });
});
