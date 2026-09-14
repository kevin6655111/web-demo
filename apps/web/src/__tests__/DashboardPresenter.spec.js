import { describe, expect, it } from 'vitest';
import { DashboardPresenter } from '../presenters/DashboardPresenter';

/**
 * Presenter 是前端的「決策層」：顏色、門檻、去重、單位換算都在這裡。
 * 這些規則錯了會誤導看板前的人，所以測試集中在這一層 ——
 * 不需要 DOM，跑起來是毫秒級的。
 */
describe('DashboardPresenter', () => {
  describe('kpiCards', () => {
    it('沒有資料時回空陣列，不是丟例外', () => {
      expect(DashboardPresenter.kpiCards(undefined)).toEqual([]);
    });

    it('平均修復時間為 null 時顯示 0 而不是 null', () => {
      const cards = DashboardPresenter.kpiCards({ TODAY: 3, PENDING: 5, REPAIR_RATE: 40, AVG_REPAIR_HOURS: null });
      expect(cards.find((c) => c.key === 'AVG_REPAIR_HOURS').value).toBe(0);
    });

    it('四張卡片各有標籤、單位與說明', () => {
      const cards = DashboardPresenter.kpiCards({ TODAY: 1, PENDING: 2, REPAIR_RATE: 3, AVG_REPAIR_HOURS: 4 });
      expect(cards).toHaveLength(4);
      expect(cards.every((c) => c.label && c.unit && c.hint && c.tone)).toBe(true);
    });
  });

  describe('mergeIncoming', () => {
    const incoming = {
      caseId: 7,
      externalId: 'E-7',
      crackType: 'Potholes',
      detectedAt: '2026-08-28T10:00:00Z',
      lng: 120,
      lat: 24
    };

    it('新案件插在最前面並標記為新', () => {
      const result = DashboardPresenter.mergeIncoming([{ ID: 1 }], incoming);
      expect(result[0].ID).toBe(7);
      expect(result[0].IS_NEW).toBe(true);
    });

    it('已存在的案件不會重複加入(重連後會收到舊訊息)', () => {
      const list = [{ ID: 7 }];
      expect(DashboardPresenter.mergeIncoming(list, incoming)).toBe(list);
    });

    it('清單長度不超過上限', () => {
      const list = Array.from({ length: 12 }, (_, i) => ({ ID: i + 100 }));
      expect(DashboardPresenter.mergeIncoming(list, incoming, 12)).toHaveLength(12);
    });
  });

  describe('overdue', () => {
    it('超過一天用天數表示，未滿一天用小時', () => {
      const [a, b] = DashboardPresenter.overdue([
        { ID: 1, OVERDUE_HOURS: 50 },
        { ID: 2, OVERDUE_HOURS: 5 }
      ]);
      expect(a.OVERDUE_TEXT).toBe('逾期 2 天');
      expect(b.OVERDUE_TEXT).toBe('逾期 5 小時');
    });

    it('逾期三天以上標記為嚴重', () => {
      const [a, b] = DashboardPresenter.overdue([
        { ID: 1, OVERDUE_HOURS: 72 },
        { ID: 2, OVERDUE_HOURS: 47 }
      ]);
      expect(a.SEVERE).toBe(true);
      expect(b.SEVERE).toBe(false);
    });
  });

  describe('hotspots', () => {
    it('比例以最大值為基準，且不會除以零', () => {
      expect(DashboardPresenter.hotspots([])).toEqual([]);

      const rows = DashboardPresenter.hotspots([
        { ROAD: 'A', COUNT: 10 },
        { ROAD: 'B', COUNT: 5 }
      ]);
      expect(rows[0].RATIO).toBe(1);
      expect(rows[1].RATIO).toBe(0.5);
    });
  });

  it('未知狀態有預設顏色，不會回 undefined 讓畫面破版', () => {
    // 顏色走 CSS 變數：值在 global.css 依 data-theme 換，呼叫端不必知道目前是日還是夜
    expect(DashboardPresenter.statusColor(1)).toBe('var(--c-info)');
    expect(DashboardPresenter.statusColor(2)).toBe('var(--c-success)');
    expect(DashboardPresenter.statusColor('WHATEVER')).toBe('var(--c-neutral)');
  });
});
