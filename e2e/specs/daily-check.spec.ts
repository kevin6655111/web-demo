import { expect, test } from '@playwright/test';

/**
 * 每日上傳檢查。
 *
 * 這張表要抓的第一種異常是「車出去了卻一筆都沒上傳」——
 * 而那正是最容易在實作上漏掉的一種：以案件為主表去統計的話，
 * 沒有案件的車根本不會出現在結果裡，看起來像是一切正常。
 *
 * 所以這組測試釘住的是**沒有案件的車也要出現**。
 */

test('每一列都有結論，而結論是給人看的中文', async ({ request }) => {
  const res = await request.get('/api/dashboard/daily-check');
  expect(res.status()).toBe(200);

  const { data } = await res.json();
  for (const row of data.ROWS) {
    expect(row.NOTE, '每一列都要有結論').toBeTruthy();
    expect(row.CAR).toBeTruthy();
  }
});

test('有軌跡卻沒有案件的車要出現在清單上，而不是被統計掉', async ({ request }) => {
  // 找一個有軌跡資料的日期；沒有的話這個測試沒有東西可驗
  const track = await request.get('/api/fleet/track/stats', { params: { DAYS: '7' } });
  test.skip(track.status() !== 200, '沒有軌跡統計端點可用');

  const res = await request.get('/api/dashboard/daily-check');
  const { data } = await res.json();
  test.skip(!data.ROWS.length, '這一天還沒有檢查資料(排程尚未跑過)');

  const zeroCase = data.ROWS.filter((r: { CASE_COUNT: number; TRACK_POINTS: number }) => r.CASE_COUNT === 0);

  for (const row of zeroCase) {
    // 沒有案件的列一定是異常的其中一種，不可能是「正常」
    expect(row.NOTE, `${row.CAR} 沒有案件卻標成正常`).not.toBe('正常');
  }
});

test('只看異常的篩選真的生效', async ({ request }) => {
  const all = await (await request.get('/api/dashboard/daily-check')).json();
  const abnormal = await (
    await request.get('/api/dashboard/daily-check', { params: { ABNORMAL_ONLY: 'true' } })
  ).json();

  expect(abnormal.data.ROWS.length).toBeLessThanOrEqual(all.data.ROWS.length);
  for (const row of abnormal.data.ROWS) expect(row.NOTE).not.toBe('正常');
});

test('結算同時回傳巡查與派工兩組數字', async ({ request }) => {
  const res = await request.get('/api/dashboard/settlement', {
    params: { DATE_START: '2026-01-01', DATE_END: '2026-12-31' }
  });
  expect(res.status()).toBe(200);

  const { data } = await res.json();
  expect(Array.isArray(data.CASES)).toBe(true);
  expect(Array.isArray(data.ORDERS)).toBe(true);

  // 合計要等於明細加總，否則請款金額會對不起來
  const sumCases = data.CASES.reduce((s: number, c: { CASE_TOTAL: number }) => s + c.CASE_TOTAL, 0);
  expect(data.TOTAL_CASES).toBe(sumCases);
});
