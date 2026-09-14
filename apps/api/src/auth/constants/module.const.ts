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
    ACCEPT: 'WORK_ORDER.ACCEPT', // 驗收
    /** 完工、撤回、復原 —— 這三個都會改變「已經回報過的事實」，比一般更新更重 */
    APPROVE: 'WORK_ORDER.APPROVE',
    DELETE: 'WORK_ORDER.DELETE'
  },
  MAINTENANCE: {
    READ: 'MAINTENANCE.READ',
    CREATE: 'MAINTENANCE.CREATE',
    UPDATE: 'MAINTENANCE.UPDATE',
    APPROVE: 'MAINTENANCE.APPROVE', // 復原
    DELETE: 'MAINTENANCE.DELETE'
  },
  REPORT: {
    READ: 'REPORT.READ',
    CREATE: 'REPORT.CREATE'
  },
  FLEET: {
    READ: 'FLEET.READ',
    UPDATE: 'FLEET.UPDATE', // 車輛基本資料維護
    COMMAND: 'FLEET.COMMAND' // 對車機下指令(串流、ECU)
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
    CREATE: 'SURVEY.CREATE', // App 收案
    UPDATE: 'SURVEY.UPDATE',
    EXPERT: 'SURVEY.EXPERT' // 專家系統：轉讓案件、審視全欄位
  },
  SUPPORT: {
    /** 每個登入者都能發問，所以沒有 READ —— 有的是「以客服身分處理別人的問題」 */
    AGENT: 'SUPPORT.AGENT'
  },
  DASHBOARD: {
    READ: 'DASHBOARD.READ',
    SETTLE: 'DASHBOARD.SETTLE' // 手動重算結算
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
  },
  /** 對接系統與車機用的 API Key：核發、停用 */
  API_KEY: {
    MANAGE: 'API_KEY.MANAGE'
  },
  /**
   * 二篩。
   *
   * 四個動作分開，因為它們是四種不同的人：
   *   READ   看清單與統計 —— 業主代表也會想看判讀進度
   *   JUDGE  判定 —— 判讀員的日常
   *   REVIEW 覆核 —— 管理者推翻判讀員的結果；判讀員自己不該有
   *   MANAGE 薪資 —— 看得到別人的薪資是另一件事
   *
   * 把判定併進 READ 的話，檢視者也能判；把覆核給判讀員的話，
   * 他可以把管理者推翻的結果再改回來，而薪資是按判定量計價的。
   */
  SIFT: {
    READ: 'SIFT.READ',
    JUDGE: 'SIFT.JUDGE',
    REVIEW: 'SIFT.REVIEW',
    MANAGE: 'SIFT.MANAGE'
  },
  /** 道路設定：巡查路線、路段啟用、道路區塊 */
  ROAD_SETTING: {
    READ: 'ROAD_SETTING.READ',
    UPDATE: 'ROAD_SETTING.UPDATE'
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
      // 巡查員的主要工作就是開巡查單：現場看到什麼就記什麼
      ACTION.MAINTENANCE.READ,
      ACTION.MAINTENANCE.CREATE,
      ACTION.MAINTENANCE.UPDATE,
      ACTION.REPORT.READ,
      ACTION.REPORT.CREATE,
      ACTION.DASHBOARD.READ,
      ACTION.FLEET.READ,
      ACTION.TRACK.READ,
      ACTION.TRACK.CREATE,
      ACTION.ROAD_EVAL.READ,
      ACTION.PROJECT.READ,
      ACTION.SURVEY.READ,
      ACTION.SURVEY.CREATE,
      ACTION.SURVEY.UPDATE,
      ACTION.SIFT.READ,
      ACTION.SIFT.JUDGE,
      ACTION.ROAD_SETTING.READ,
      ACTION.SUPPORT.AGENT
    ] as string[]
  },
  WORKER: {
    name: '施工人員',
    actions: [
      ACTION.CASE.READ,
      ACTION.WORK_ORDER.READ,
      ACTION.WORK_ORDER.UPDATE,
      // 巡修單是「當場修掉」的紀錄，施工人員自己就要能開
      ACTION.MAINTENANCE.READ,
      ACTION.MAINTENANCE.CREATE,
      ACTION.MAINTENANCE.UPDATE,
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
      ACTION.MAINTENANCE.READ,
      ACTION.REPORT.READ,
      ACTION.DASHBOARD.READ,
      ACTION.FLEET.READ,
      ACTION.TRACK.READ,
      ACTION.ROAD_EVAL.READ,
      ACTION.SIFT.READ,
      ACTION.SURVEY.READ,
      ACTION.ROAD_SETTING.READ
    ] as string[]
  }
} as const;
