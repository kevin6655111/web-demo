import type { KeyDef, ValueDef } from './lookup';

/**
 * 道路區塊類型：路段設定用。
 * 決定一段路「算不算該巡」與「怎麼計價」——快速道路不歸市區巡查標案。
 */
export const ROAD_BLOCK_TYPE_DEF = [
  { key: 'MAIN', name: '主要道路' },
  { key: 'SECONDARY', name: '次要道路' },
  { key: 'LANE', name: '巷弄' },
  { key: 'EXPRESS', name: '快速道路' }
] as const satisfies readonly KeyDef[];

/** 道路區塊狀態 */
export const ROAD_BLOCK_STATUS_DEF = [
  { value: 0, name: '未設定', color: 'neutral' },
  { value: 1, name: '納入巡查', color: 'success' },
  { value: 2, name: '不納入', color: 'muted' },
  { value: 3, name: '施工中', color: 'warning' }
] as const satisfies readonly ValueDef[];

/**
 * 管轄單位。
 * 同一條路可能由市府、公所或國道單位管，巡查路線要排除不歸自己管的線段。
 */
export const JURISDICTION_DEF = [
  { key: 'CITY', name: '市府' },
  { key: 'TOWNSHIP', name: '公所' },
  { key: 'HIGHWAY', name: '公路單位' },
  { key: 'OTHER', name: '其他' }
] as const satisfies readonly KeyDef[];

/** 車機通訊狀態：跟車輛狀態分開 —— 車機連著但車沒在跑是常態 */
export const VEHICLE_COMM_STATE_DEF = [
  { key: 'CONNECTED', name: '連線中', color: 'success' },
  { key: 'STREAMING', name: '串流中', color: 'info' },
  { key: 'DISCONNECTED', name: '已斷線', color: 'neutral' }
] as const;

export type VehicleCommState = (typeof VEHICLE_COMM_STATE_DEF)[number]['key'];

/** 鋪面調查的路段方向 */
export const SURVEY_DIRECTION_DEF = [
  { key: 'BOTH', name: '雙向' },
  { key: 'FORWARD', name: '順向' },
  { key: 'BACKWARD', name: '逆向' }
] as const satisfies readonly KeyDef[];

/** 鋪面調查案件狀態(App 回報的實地案件) */
export const SURVEY_CASE_STATE_DEF = [
  { key: 'PENDING', name: '待調查', color: 'warning' },
  { key: 'DONE', name: '已完成', color: 'success' },
  { key: 'REJECTED', name: '不予採計', color: 'muted' },
  { key: 'DELETED', name: '已刪除', color: 'error' }
] as const;

export type SurveyCaseStateKey = (typeof SURVEY_CASE_STATE_DEF)[number]['key'];

/** 人員的系統首頁：登入後預設進哪個模組 */
export const HOME_SYS_DEF = [
  { key: 'DASHBOARD', name: '儀表板' },
  { key: 'MAP_MOD', name: '圖台管理' },
  { key: 'CASE_MOD', name: '案件管理' },
  { key: 'SIFT_MOD', name: '二篩系統' },
  { key: 'SURVEY_MOD', name: '鋪面調查' }
] as const satisfies readonly KeyDef[];
