import { describe, it, expect } from 'vitest';
import { HttpResponse } from '@/http/http-response';

/** 回應信封是前端唯一的契約，格式跑掉的成本很高，用測試釘住 */
describe('HttpResponse', () => {
  it('success 帶 status=true 與預設 200', () => {
    expect(HttpResponse.success({ data: { ID: 1 } })).toEqual({
      status: true,
      code: 200,
      message: undefined,
      data: { ID: 1 },
      errors: undefined
    });
  });

  it('error 預設 500 且不帶 data', () => {
    const res = HttpResponse.error({ message: '壞了' });
    expect(res.status).toBe(false);
    expect(res.code).toBe(500);
    expect(res).not.toHaveProperty('data');
  });

  it.each([
    ['空陣列', [], false],
    ['空物件', {}, false],
    ['空字串', '   ', false],
    ['null', null, false],
    ['有資料', [{ ID: 1 }], true],
    ['數字 0', 0, true] // 0 是有效資料，不能當成空值
  ])('successOrWarn 對 %s 判定 status=%s', (_label, data, expected) => {
    expect(HttpResponse.successOrWarn({ data }).status).toBe(expected);
  });

  it('successOrWarn 可自訂空值判斷', () => {
    const res = HttpResponse.successOrWarn({ data: { ROWS: [] }, isEmpty: (v) => !v?.ROWS?.length });
    expect(res.status).toBe(false);
    expect(res.message).toBe('查無資料');
  });
});
