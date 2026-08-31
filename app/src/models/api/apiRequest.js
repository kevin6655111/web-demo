/**
 * 統一的 API 呼叫層。
 *
 * 後端回的是固定信封 { status, code, message, data }，
 * 所以錯誤處理只需要寫這一次 —— 各畫面拿到的要嘛是 data，要嘛是一個帶訊息的例外。
 */

const BASE = '/api';

/**
 * 憑證失效事件。
 *
 * 401 可能發生在任何一支 API 上，而處理方式只有一種：清掉登入狀態、回登入頁。
 * 讓每個呼叫端各自處理的話，總會有幾支漏掉 ——
 * 使用者就會停在一個看起來正常、但每個操作都失敗的畫面上。
 */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, params, signal, formData } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url, {
    method,
    // 帶 cookie：token 存在 httpOnly cookie 裡，JS 讀不到也送不出去，只能靠瀏覽器自己帶
    credentials: 'include',
    // multipart 不能自己設 Content-Type：boundary 由瀏覽器產生，
    // 手動設定會讓後端解不出檔案(而且錯誤訊息不會提到 boundary)
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: formData ?? (body ? JSON.stringify(body) : undefined),
    signal
  });

  if (res.status === 401) {
    // 廣播出去，由 UserContext 統一處理：清狀態、回登入頁、告訴使用者原因
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    throw new ApiError('登入已過期，請重新登入', 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.message || `請求失敗(${res.status})`, res.status);

  return json;
}

export const api = {
  get: (path, params, opts) => request(path, { ...opts, params }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  // DELETE 也允許帶 body：刪某一張照片要指定是哪一張，塞進網址會讓路徑變得很怪
  del: (path, body) => request(path, { method: 'DELETE', body }),
  upload: (path, formData) => request(path, { method: 'POST', formData })
};
