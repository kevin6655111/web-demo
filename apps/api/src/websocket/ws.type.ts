/** 前端可訂閱的廣播頻道 */
export const WS_CHANNEL = [
  'case',
  'maintenance',
  'workorder',
  'report',
  'task',
  'presence',
  'fleet',
  'lock',
  'support'
] as const;
export type WsChannel = (typeof WS_CHANNEL)[number];

/**
 * 前端 → 後端。
 *
 * 不只車機推案件：這條連線同時承擔四種雙向互動 ——
 *   chat      案件討論(訊息落地，斷線補得回來)
 *   presence  誰在線、正在看哪個案件
 *   location  車輛/人員位置回報(只進 Redis，位置只有「現在」有價值)
 *   lock      編輯鎖，避免兩個人同時改同一張派工單
 */
export type ClientMessage =
  | { type: 'subscribe'; channels: WsChannel[] }
  | { type: 'unsubscribe'; channels: WsChannel[] }
  | { type: 'ping' }
  /** 進入/離開某個案件的討論串(同時代表「我正在看這個案件」) */
  | { type: 'case.enter'; caseId: number }
  | { type: 'case.leave'; caseId: number }
  /** 送出討論訊息 */
  | { type: 'chat.send'; caseId: number; body: string }
  /** 位置回報(車機、手機) */
  | { type: 'location.report'; lng: number; lat: number; speedKph?: number; heading?: number }
  /** 取得/釋放編輯鎖 */
  | { type: 'lock.acquire'; resource: string }
  | { type: 'lock.release'; resource: string };

/** 後端 → 前端 */
export type ServerMessage =
  | { type: 'welcome'; data: { uid: number; account: string; companyId: number; channels: WsChannel[] } }
  | { type: 'subscribed'; data: { channels: WsChannel[] } }
  | { type: 'pong'; data: { at: number } }
  | { type: 'error'; data: { message: string } }
  | { type: 'chat.history'; data: { caseId: number; messages: unknown[] } }
  | { type: 'lock.result'; data: { resource: string; granted: boolean; holder?: string } }
  | { type: string; data: unknown };
