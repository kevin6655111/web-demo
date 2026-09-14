import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CasePresenter } from '../presenters/CasePresenter';

describe('CasePresenter', () => {
  it('未知代碼原樣顯示，不會變成 undefined', () => {
    expect(CasePresenter.crackLabel('Potholes')).toBe('坑洞');
    expect(CasePresenter.crackLabel('NEW_TYPE')).toBe('NEW_TYPE');
    // 狀態是數字代碼：二篩狀態與修繕狀態是兩套，不能互相套用
    expect(CasePresenter.statusLabel(1)).toBe('通過');
    expect(CasePresenter.needRepairLabel(1)).toBe('觀察中');
    expect(CasePresenter.degreeLabel('A')).toBe('嚴重');
    expect(CasePresenter.workOrderLabel(3)).toBe('已完工');
    expect(CasePresenter.workOrderTypeLabel('PC')).toBe('AI 車巡');
  });

  describe('time', () => {
    beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-08-28T15:00:00+08:00')));
    afterEach(() => vi.useRealTimers());

    it('今天的時間只顯示時分，其他日期補上月日', () => {
      expect(CasePresenter.time('2026-08-28T09:05:00+08:00')).toBe('09:05');
      expect(CasePresenter.time('2026-08-20T09:05:00+08:00')).toContain('08/20');
    });

    it('空值回空字串而不是 Invalid Date', () => {
      expect(CasePresenter.time(null)).toBe('');
      expect(CasePresenter.time(undefined)).toBe('');
    });
  });

  describe('changeText', () => {
    it('狀態與類型翻成中文，欄位名也是', () => {
      expect(CasePresenter.changeText('status', { from: 0, to: 1 })).toBe('二篩狀態：未審 → 通過');
      expect(CasePresenter.changeText('needRepair', { from: 1, to: 2 })).toBe('案件狀態：觀察中 → 已派工');
      expect(CasePresenter.changeText('crackType', { from: 'Cracking', to: 'Potholes' })).toBe(
        '破壞類型：線狀裂縫 → 坑洞'
      );
    });

    it('空值顯示為「（空）」，讓「原本沒有」看得出來', () => {
      expect(CasePresenter.changeText('road', { from: null, to: '中山路一段' })).toBe('路名：（空） → 中山路一段');
    });

    it('陣列與布林也讀得懂：試驗項目是陣列，取樣是布林', () => {
      expect(CasePresenter.fieldValue('testItem', ['壓實度', '厚度'])).toBe('壓實度、厚度');
      expect(CasePresenter.fieldValue('testItem', [])).toBe('（空）');
      expect(CasePresenter.fieldValue('sampleTaken', false)).toBe('否');
    });
  });

  it('每個歷程動作都有中文與顏色', () => {
    for (const action of [
      'CREATED',
      'UPDATED',
      'GEOCODED',
      'STATUS_CHANGED',
      'DISPATCHED',
      'ACCEPTED',
      'RETURNED',
      'IMAGE_UPLOADED',
      'RESTORED'
    ]) {
      const meta = CasePresenter.actionMeta(action);
      expect(meta.label).toBeTruthy();
      // 顏色走 CSS 變數，值由 global.css 依 data-theme 決定 ——
      // 呼叫端不必知道目前是日還是夜
      expect(meta.color).toMatch(/^var\(--c-/);
    }
  });

  it('歷程來源分得出人工、排程與車機 —— 追查問題時這個差別很大', () => {
    expect(CasePresenter.sourceMeta('DEVICE').label).toBe('車機上傳');
    expect(CasePresenter.sourceMeta('TASK').label).toBe('排程');
    expect(CasePresenter.sourceMeta(undefined).label).toBe('—');
  });
});
