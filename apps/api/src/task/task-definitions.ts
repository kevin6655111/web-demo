export type TaskKey =
  | 'caseAutoCode'
  | 'databaseBackup'
  | 'lineNotify'
  | 'roadEvalStat'
  | 'dailyCheck'
  | 'patrolPointCov'
  | 'addressGeocoder'
  | 'pathUpdater'
  | 'dashboardSync'
  | 'tilesWarmup'
  | 'partitionMaintain';

export type TaskDef = {
  label: string;
  cron: string;
  timeoutMs?: number;
};

/**
 * 排程清單。
 *
 * cron 與逾時寫在程式裡、開關寫在 yaml —— 分界的理由是「誰有權決定」：
 * 「幾點跑、跑多久算爆掉」是工程判斷，站台不該各自亂改；
 * 「這個站台要不要跑」才是站台的事。
 *
 * timeoutMs 是必要的：排程沒有使用者在等，卡住不會有人抱怨，
 * 只會安靜地佔著鎖直到下一次部署。
 */
export const TASK_DEFS: Record<TaskKey, TaskDef> = {
  caseAutoCode: { label: '案件編碼', cron: '* 7-22 * * *', timeoutMs: 5 * 60_000 }, // 07:00-22:59 每分鐘
  databaseBackup: { label: '資料庫備份', cron: '50 23 * * *', timeoutMs: 5 * 60 * 60_000 }, // 每日 23:50
  lineNotify: { label: '通知推播', cron: '0 14,18 * * *', timeoutMs: 30 * 60_000 }, // 每日 14:00、18:00
  roadEvalStat: { label: '道路評估統計', cron: '0 23 * * *', timeoutMs: 60 * 60_000 }, // 每日 23:00
  dailyCheck: { label: '每日檢查上傳狀態', cron: '45 8-23 * * *', timeoutMs: 60 * 60_000 }, // 08:45-23:45 每小時 45 分
  patrolPointCov: { label: '巡查點覆蓋率統計', cron: '0 * * * *', timeoutMs: 60 * 60_000 }, // 每小時
  addressGeocoder: { label: '地址編碼', cron: '0 20 * * *', timeoutMs: 3 * 60 * 60_000 }, // 每日 20:00
  pathUpdater: { label: '路徑更新', cron: '0 1 * * *', timeoutMs: 30 * 60_000 }, // 每日 01:00
  dashboardSync: { label: '儀表板結算', cron: '30 23 * * *', timeoutMs: 60 * 60_000 }, // 每日 23:30
  tilesWarmup: { label: '圖層快取預熱', cron: '0 7,8 * * *', timeoutMs: 60 * 60_000 }, // 每日 07:00、08:00
  partitionMaintain: { label: '資料表維護', cron: '0 3 1 * *', timeoutMs: 10 * 60_000 } // 每月 1 日 03:00
};
