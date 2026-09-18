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

/**
 * 可以下給車機的指令。
 *
 * `danger` 標的那一個會中斷正在進行的巡查：車機重開機要一兩分鐘，
 * 這段時間的軌跡與案件全部沒有 —— 所以介面上要問一次再送。
 *
 * 指令是**非同步**的：伺服器送出之後等車機回 ack，逾時就回報逾時，
 * 而不是假裝送到了。收訊差的地方這件事每天都在發生。
 */
export const COMMAND_ACTION_DEF = [
  { key: 'STREAM_START', name: '開始串流', hint: '要車機把即時影像推上來' },
  { key: 'STREAM_STOP', name: '停止串流', hint: '省流量；巡查結束後應該關掉' },
  { key: 'ECU_QUERY', name: '查詢車況', hint: '電壓、轉速、里程表、故障碼' },
  { key: 'SNAPSHOT', name: '拍一張', hint: '不開串流也看得到現在的畫面' },
  { key: 'REBOOT', name: '重新開機', danger: true, hint: '會中斷巡查一到兩分鐘' }
] as const;

export type CommandActionKey = (typeof COMMAND_ACTION_DEF)[number]['key'];

/** 串流狀態；`ERROR` 要看得出來，否則督導會以為畫面只是還沒載入 */
export const STREAM_STATE_DEF = [
  { key: 'IDLE', name: '未串流', color: 'muted' },
  { key: 'STARTING', name: '啟動中', color: 'info' },
  { key: 'STREAMING', name: '串流中', color: 'success' },
  { key: 'ERROR', name: '串流失敗', color: 'error' }
] as const;

export type StreamStateKey = (typeof STREAM_STATE_DEF)[number]['key'];

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

/**
 * 建物用途。
 *
 * 這不是分類癖 —— 每一種在**施工時段**上的限制不同：
 * 住宅區不能夜間施工、學校要避開上下學、醫院不能封死出入口。
 * 交維計畫要依它篩，所以它是列舉而不是備註欄。
 */
export const BUILDING_USAGE_DEF = [
  { key: 'RESIDENTIAL', name: '住宅', color: 'info', note: '夜間施工需另行公告' },
  { key: 'COMMERCIAL', name: '商業', color: 'warning', note: '避開營業尖峰' },
  { key: 'INDUSTRIAL', name: '工業', color: 'neutral', note: '需留大型車進出動線' },
  { key: 'SCHOOL', name: '學校', color: 'error', note: '須避開上下學時段' },
  { key: 'HOSPITAL', name: '醫療', color: 'error', note: '不得封閉出入口' },
  { key: 'PUBLIC', name: '公共設施', color: 'success', note: '需先知會管理單位' }
] as const;

export type BuildingUsageKey = (typeof BUILDING_USAGE_DEF)[number]['key'];

/** 施工前要另外評估交維的用途：這兩種不是「多一點住戶」那種等級的差別 */
export const SENSITIVE_BUILDING_USAGE: readonly BuildingUsageKey[] = ['SCHOOL', 'HOSPITAL'];

/** 行政區界線的三個層級；派工按里分派，報表按里統計 */
export const REGION_LEVEL_DEF = [
  { key: 'COUNTY', name: '縣市' },
  { key: 'DISTRICT', name: '行政區' },
  { key: 'VILLAGE', name: '里' }
] as const satisfies readonly KeyDef[];

export type RegionLevelKey = (typeof REGION_LEVEL_DEF)[number]['key'];
