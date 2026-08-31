/**
 * 功能權限清單。
 *
 * 權限的最小單位是「功能 × 動作」，字串固定寫成 <FEATURE>.<ACTION>，
 * 存進 roles.actions 陣列，controller 用 @RequireAction 標註需要哪一個。
 * 用常數而不是散落字串，是為了改名時編譯期就會炸，而不是上線後才 403。
 */
export const ACTION = {
  CASE: {
    READ: 'CASE.READ',
    CREATE: 'CASE.CREATE',
    UPDATE: 'CASE.UPDATE',
    DELETE: 'CASE.DELETE'
  },
  WORK_ORDER: {
    READ: 'WORK_ORDER.READ',
    CREATE: 'WORK_ORDER.CREATE', // 派工
    UPDATE: 'WORK_ORDER.UPDATE', // 回報進度
    ACCEPT: 'WORK_ORDER.ACCEPT' // 驗收
  },
  REPORT: {
    READ: 'REPORT.READ',
    CREATE: 'REPORT.CREATE'
  },
  FLEET: {
    READ: 'FLEET.READ',
    UPDATE: 'FLEET.UPDATE' // 車輛基本資料維護
  },
  TRACK: {
    READ: 'TRACK.READ',
    CREATE: 'TRACK.CREATE' // 車機上傳軌跡
  },
  ROAD_EVAL: {
    READ: 'ROAD_EVAL.READ',
    UPDATE: 'ROAD_EVAL.UPDATE' // 人工調整路段評分
  },
  PROJECT: {
    READ: 'PROJECT.READ',
    CREATE: 'PROJECT.CREATE',
    UPDATE: 'PROJECT.UPDATE'
  },
  SURVEY: {
    READ: 'SURVEY.READ',
    UPDATE: 'SURVEY.UPDATE'
  },
  SUPPORT: {
    /** 每個登入者都能發問，所以沒有 READ —— 有的是「以客服身分處理別人的問題」 */
    AGENT: 'SUPPORT.AGENT'
  },
  DASHBOARD: {
    READ: 'DASHBOARD.READ'
  },
  TASK: {
    READ: 'TASK.READ',
    RUN: 'TASK.RUN' // 手動觸發排程
  },
  SYSTEM: {
    /** 稽核查詢：跨實體看「誰在什麼時候改了什麼」，只給管理者 */
    AUDIT: 'SYSTEM.AUDIT'
  },
  ACCOUNT_MANAGE: {
    READ: 'ACCOUNT.READ',
    CREATE: 'ACCOUNT.CREATE',
    UPDATE: 'ACCOUNT.UPDATE',
    DELETE: 'ACCOUNT.DELETE'
  }
} as const;

const all = Object.values(ACTION).flatMap((group) => Object.values(group)) as string[];

/** 系統裡所有動作鍵；平台層的開通上限，也是權限矩陣的欄位來源 */
export const ACTION_KEYS: readonly string[] = all;

/** 內建角色：seed 用，也是新站台開站時的預設值 */
export const ROLE_PRESET = {
  ADMIN: {
    name: '系統管理員',
    actions: all
  },
  INSPECTOR: {
    name: '巡查員',
    actions: [
      ACTION.CASE.READ,
      ACTION.CASE.CREATE,
      ACTION.CASE.UPDATE,
      ACTION.WORK_ORDER.READ,
      ACTION.WORK_ORDER.CREATE,
      ACTION.REPORT.READ,
      ACTION.REPORT.CREATE,
      ACTION.DASHBOARD.READ,
      ACTION.FLEET.READ,
      ACTION.TRACK.READ,
      ACTION.TRACK.CREATE,
      ACTION.ROAD_EVAL.READ,
      ACTION.PROJECT.READ,
      ACTION.SURVEY.READ,
      ACTION.SURVEY.UPDATE,
      ACTION.SUPPORT.AGENT
    ] as string[]
  },
  WORKER: {
    name: '施工人員',
    actions: [
      ACTION.CASE.READ,
      ACTION.WORK_ORDER.READ,
      ACTION.WORK_ORDER.UPDATE,
      ACTION.DASHBOARD.READ,
      ACTION.TRACK.CREATE,
      ACTION.FLEET.READ
    ] as string[]
  },
  VIEWER: {
    name: '檢視者',
    actions: [
      ACTION.CASE.READ,
      ACTION.WORK_ORDER.READ,
      ACTION.REPORT.READ,
      ACTION.DASHBOARD.READ,
      ACTION.FLEET.READ,
      ACTION.TRACK.READ,
      ACTION.ROAD_EVAL.READ
    ] as string[]
  }
} as const;
