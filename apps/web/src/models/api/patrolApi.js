import { api } from './apiRequest';

/** 所有 API 呼叫集中在這裡：畫面不直接拼路徑，改介面時只有這個檔案要動 */
export const authApi = {
  login: (COMPANY_KEY, ACCOUNT, PASSWORD) => api.post('/user/authenticate', { COMPANY_KEY, ACCOUNT, PASSWORD }),
  prefs: () => api.get('/auth/user/prefs'),
  refresh: () => api.put('/auth/refresh-token'),
  logout: () => api.post('/auth/logout'),
  roles: () => api.get('/auth/role'),
  actions: () => api.get('/auth/action'),
  orgUsers: (params) => api.get('/auth/org/user', params),
  createAccount: (body) => api.post('/auth/account', body),
  setActive: (body) => api.put('/auth/account', body),
  createRole: (body) => api.post('/auth/role', body),
  updateRoleActions: (body) => api.put('/auth/role/action', body)
};

export const supportApi = {
  open: (body) => api.post('/support/thread', body),
  myThreads: () => api.get('/support/thread/mine'),
  threads: (params) => api.get('/support/thread', params),
  messages: (id) => api.get(`/support/thread/${id}/message`),
  send: (body) => api.post('/support/message', body),
  update: (body) => api.put('/support/thread', body)
};

export const navApi = {
  userNav: () => api.get('/auth/user/nav')
};

export const fleetApi = {
  vehicles: (params) => api.get('/fleet/vehicle', params),
  upsertVehicle: (body) => api.post('/fleet/vehicle', body),
  track: (params) => api.get('/fleet/track', params),
  trackStats: (params) => api.get('/fleet/track/stats', params),
  /** 車機連線狀態；來源是 Redis 的連線工作階段，不是資料庫 */
  comm: () => api.get('/fleet/comm'),
  /** 對車機下指令，等車機回 ack；逾時會回錯而不是假裝送到了 */
  command: (DEVICE_ID, ACTION, PAYLOAD) => api.post('/fleet/comm/command', { DEVICE_ID, ACTION, PAYLOAD }),
  simulate: (body) => api.post('/fleet/comm/simulate', body),
  stopSimulate: (deviceId) => api.del(`/fleet/comm/simulate/${deviceId}`)
};

/**
 * 地理資料：行政區界線、建物、逆地理編碼。
 *
 * 這幾支和 `tilesApi` 的差別在**更新頻率**：界線與建物一年動一次，
 * 案件每分鐘都在動。分開才能各自用合適的快取期限。
 */
export const geoApi = {
  region: (params) => api.get('/geo/region', params),
  locate: (LNG, LAT) => api.get('/geo/locate', { LNG, LAT }),
  building: (params) => api.get('/geo/building', params),
  buildingImpact: (LNG, LAT, RADIUS) => api.get('/geo/building-impact', { LNG, LAT, RADIUS }),
  roadMeas: (params) => api.get('/geo/road-meas', params),
  districtBounds: () => api.get('/geo/district-bounds')
};

export const roadEvalApi = {
  segments: (params) => api.get('/roadeval/segment', params),
  layer: (params) => api.get('/roadeval/layer', params),
  summary: () => api.get('/roadeval/summary'),
  update: (body) => api.put('/roadeval/segment', body),
  evaluate: (body) => api.post('/roadeval/evaluate', body ?? {})
};

/**
 * 道路設定與巡查點。
 *
 * 線段、區塊、巡查點都以 GeoJSON `FeatureCollection` 回傳 ——
 * 圖台的每一種圖層走同一個格式，新增一種圖徵不必在前端多寫一種解析。
 */
export const roadSettingApi = {
  lines: (params) => api.get('/road-setting/line', params),
  setLinesActive: (IDS, IS_ACTIVE, REMARK) => api.put('/road-setting/line/active', { IDS, IS_ACTIVE, REMARK }),
  setJurisdiction: (IDS, JURISDICTION) => api.put('/road-setting/line/jurisdiction', { IDS, JURISDICTION }),
  renameLine: (ID, DISPLAY_NAME) => api.put('/road-setting/line/name', { ID, DISPLAY_NAME }),
  blocks: (params) => api.get('/road-setting/block', params),
  updateBlocks: (body) => api.put('/road-setting/block', body),
  points: (params) => api.get('/road-setting/point', params),
  upsertPoint: (body) => api.post('/road-setting/point', body),
  pointCoverage: (params) => api.get('/road-setting/point-coverage', params),
  draw: (ROUTE, BUFFER_M) => api.post('/road-setting/draw', { ROUTE, BUFFER_M })
};

export const patrolPlanApi = {
  list: (params) => api.get('/patrol/plan', params),
  layer: (params) => api.get('/patrol/plan/layer', params),
  upsert: (body) => api.post('/patrol/plan', body),
  coverage: (params) => api.get('/patrol/coverage', params)
};

/**
 * 鋪面調查。
 *
 * 委託單底下有明細(業主指定的路段)，明細底下才是調查點 ——
 * 進度的分母是明細的取樣數，不是已經排了幾個點。
 */
export const surveyApi = {
  orders: (params) => api.get('/survey/order', params),
  upsertOrder: (body) => api.post('/survey/order', body),
  details: (orderId) => api.get(`/survey/order/${orderId}/detail`),
  upsertDetail: (body) => api.post('/survey/order/detail', body),
  cases: (params) => api.get('/survey/case', params),
  upsertCase: (body) => api.post('/survey/case', body),
  // 狀態是批次的：一趟現場會收十幾個點
  batchStatus: (IDS, STATE, REASON) => api.put('/survey/case/status', { IDS, STATE, REASON }),
  expertCases: (params) => api.get('/survey/expert/case', params),
  transfer: (IDS, TO_ORDER_ID, REASON, TO_DETAIL_ID) =>
    api.put('/survey/expert/transfer', { IDS, TO_ORDER_ID, REASON, TO_DETAIL_ID })
};

/**
 * 二篩。
 *
 * 判定與覆核都是**批次**：一批看幾十張圖，逐筆送等於逐筆按五十次。
 * 兩者是不同端點而不是同一支帶參數 —— 權限不同，而且擋下的條件也不同。
 */
export const siftApi = {
  list: (params) => api.get('/sift/case', params),
  judge: (IDS, STATUS, REMARK) => api.put('/sift/judge', { IDS, STATUS, REMARK }),
  review: (IDS, STATUS, REMARK) => api.put('/sift/review', { IDS, STATUS, REMARK }),
  stats: (params) => api.get('/sift/stats', params),
  salary: (params) => api.get('/sift/salary', params)
};

export const caseApi = {
  list: (params) => api.get('/patrol/case', params),
  detail: (id) => api.get(`/patrol/case/${id}`),
  nearby: (LNG, LAT, RADIUS_M) => api.get('/patrol/case/nearby', { LNG, LAT, RADIUS_M }),
  duplicates: (id) => api.get(`/patrol/case/${id}/duplicate`),
  updateStatus: (body) => api.put('/patrol/case/status', body),
  batchUpdateStatus: (body) => api.put('/patrol/case/status/batch', body),
  update: (body) => api.patch('/patrol/case', body),
  stats: (params) => api.get('/patrol/case/stats', params),
  messages: (id) => api.get(`/realtime/case/${id}/messages`)
};

/**
 * 歷程四種實體共用同一組端點，所以這裡也只有一組。
 * caseType：CASE_PATROL / MAINTENANCE / WORK_ORDER / PROJECT / SURVEY
 */
export const historyApi = {
  list: (caseType, id) => api.get(`/history/${caseType}/${id}`),
  version: (caseType, id, version) => api.get(`/history/${caseType}/${id}/version/${version}`),
  diff: (caseType, id, FROM, TO) => api.get(`/history/${caseType}/${id}/diff`, { CASE_TYPE: caseType, FROM, TO }),
  restore: (CASE_TYPE, ID, VERSION) => api.post('/history/restore', { CASE_TYPE, ID, VERSION }),
  audit: (params) => api.get('/history/audit', params)
};

/**
 * 巡查單。
 *
 * 狀態是**批次**端點：一趟巡查會開十幾張單，逐張送十幾次請求
 * 既慢又會讓「哪幾筆沒成功」變成十幾個各自的錯誤。
 */
export const maintenanceApi = {
  list: (params) => api.get('/maintenance', params),
  detail: (id) => api.get(`/maintenance/${id}`),
  create: (body) => api.post('/maintenance', body),
  update: (body) => api.patch('/maintenance', body),
  updateStatus: (ID, STATUS) => api.put('/maintenance/status', { ID: Array.isArray(ID) ? ID : [ID], STATUS }),
  images: (id) => api.get(`/maintenance/${id}/image`),
  uploadImages: (formData) => api.upload('/maintenance/image', formData),
  deleteImage: (body) => api.del('/maintenance/image', body)
};

export const workOrderApi = {
  list: (params) => api.get('/workorder', params),
  detail: (id) => api.get(`/workorder/${id}`),
  create: (body) => api.post('/workorder', body),
  update: (body) => api.patch('/workorder', body),
  updateStatus: (body) => api.put('/workorder/status', body),
  // 撤回與復原不是狀態而是動作碼；集中在這裡，畫面不必記得 8 跟 9 是什麼
  withdraw: (ID) => api.put('/workorder/status', { ID, STATUS: 9 }),
  restore: (ID) => api.put('/workorder/status', { ID, STATUS: 8 }),
  remove: (ID) => api.put('/workorder/status', { ID, STATUS: -1 }),
  images: (id) => api.get(`/workorder/${id}/image`),
  // 照片走 multipart：欄位名就是照片類型，一次可以傳多種
  uploadImages: (formData) => api.upload('/workorder/image', formData),
  deleteImage: (body) => api.del('/workorder/image', body)
};

/** 下層單位：平台管理廠商、廠商管理外包 —— 同一組端點服務兩層 */
export const companyApi = {
  list: (params) => api.get('/company', params),
  grantable: () => api.get('/company/grantable'),
  grants: (id) => api.get(`/company/${id}/grant`),
  create: (body) => api.post('/company', body),
  update: (body) => api.put('/company', body),
  setGrants: (body) => api.put('/company/grant', body)
};

export const dashboardApi = {
  overview: () => api.get('/dashboard/overview'),
  /** 每日上傳檢查：昨天該出車的車有沒有出、有沒有案件、照片缺不缺 */
  dailyCheck: (params) => api.get('/dashboard/daily-check', params),
  /** 結算：里程 × 案件，計價與請款的依據 */
  settlement: (params) => api.get('/dashboard/settlement', params)
};

export const projectApi = {
  list: (params) => api.get('/project', params),
  detail: (id) => api.get(`/project/${id}`),
  create: (body) => api.post('/project', body),
  updateState: (body) => api.put('/project/state', body),
  upsertRelation: (body) => api.put('/project/relation', body),
  sections: () => api.get('/project/section'),
  areas: (COUNTY) => api.get('/project/area', COUNTY ? { COUNTY } : undefined)
};

export const coreApi = {
  codes: () => api.get('/core/code'),
  announcements: () => api.get('/core/announcement'),
  upsertAnnouncement: (body) => api.post('/core/announcement', body),
  deleteAnnouncement: (id) => api.del(`/core/announcement/${id}`)
};

/**
 * 報表。
 *
 * `kinds()` 回傳每一種報表接受哪些參數與格式 —— 前端依它決定要顯示什麼欄位，
 * 而不是把十一種報表的條件全部攤開讓使用者自己挑。
 */
export const reportApi = {
  kinds: () => api.get('/report/kind'),
  create: (body) => api.post('/report', body),
  list: (params) => api.get('/report', params),
  get: (id) => api.get(`/report/${id}`),
  remove: (id) => api.del(`/report/${id}`)
};

export const taskApi = {
  status: () => api.get('/task'),
  trigger: (KEY) => api.post('/task/trigger', { KEY })
};

export const tilesApi = {
  caseLayer: (params) => api.get('/tiles/case', params)
};

export const realtimeApi = {
  presence: () => api.get('/realtime/presence'),
  fleet: () => api.get('/realtime/fleet'),
  stats: () => api.get('/realtime/stats')
};
