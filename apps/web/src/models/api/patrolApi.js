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
  trackStats: (params) => api.get('/fleet/track/stats', params)
};

export const roadEvalApi = {
  segments: (params) => api.get('/roadeval/segment', params),
  layer: (params) => api.get('/roadeval/layer', params),
  summary: () => api.get('/roadeval/summary'),
  update: (body) => api.put('/roadeval/segment', body),
  evaluate: (body) => api.post('/roadeval/evaluate', body ?? {})
};

export const patrolPlanApi = {
  list: (params) => api.get('/patrol/plan', params),
  layer: (params) => api.get('/patrol/plan/layer', params),
  upsert: (body) => api.post('/patrol/plan', body),
  coverage: (params) => api.get('/patrol/coverage', params)
};

export const surveyApi = {
  orders: (params) => api.get('/survey/order', params),
  upsertOrder: (body) => api.post('/survey/order', body),
  cases: (params) => api.get('/survey/case', params),
  upsertCase: (body) => api.post('/survey/case', body)
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
  overview: () => api.get('/dashboard/overview')
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

export const reportApi = {
  create: (body) => api.post('/report', body),
  list: () => api.get('/report'),
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
