import type { HttpResult, SuccessArgs, ErrorArgs, SuccessOrWarnArgs } from '@app-types/http.type';

function isEmptyData(v: any): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/**
 * 統一回應格式。
 * 前端只認 { status, code, message, data }，不必為每支 API 各寫一套判斷。
 */
export const HttpResponse = {
  success<T = any>({ data, message, code = 200, errors }: SuccessArgs<T>): HttpResult<T> {
    return { status: true, code, message, data, errors };
  },

  warn<T = any>({ data, message = '警告訊息', status = false, code = 200, errors }: ErrorArgs): HttpResult<T> {
    return { status, code, message, data, errors };
  },

  error<T = any>({ message = 'Server error', code = 500, errors }: ErrorArgs): HttpResult<T> {
    return { status: false, code, message, errors };
  },

  /** 查得到就 success、查不到就 warn，省掉呼叫端到處寫「查無資料」 */
  successOrWarn<T = any>({
    data,
    okMsg = '',
    warnMsg = '查無資料',
    code = 200,
    errors,
    isEmpty
  }: SuccessOrWarnArgs<T>): HttpResult<T> {
    const empty = isEmpty ? isEmpty(data) : isEmptyData(data);

    return empty
      ? HttpResponse.warn({ data, message: warnMsg, code, errors })
      : HttpResponse.success({ data, message: okMsg, code, errors });
  }
};

export type { HttpResult };
