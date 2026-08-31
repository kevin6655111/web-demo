import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@/env/env.service';
import { RedisService } from '@/redis/redis.service';
import { LogRecorderService } from '@/util/log-recorder.service';
import { TASK_DEFS, type TaskKey } from './task-definitions';

const DEFAULT_TIMEOUT_MS = 8 * 60 * 60_000;

/** scheduler 寫、api 讀的狀態快照 */
export const TASK_STATUS_KEY = 'task:status';
const STATUS_TTL_MS = 10 * 60_000;

export type TaskOutcome = { ok: boolean; detail?: unknown; skipped?: string };

/**
 * 排程執行器：所有排程都經過這裡，因此「不要重複跑」只需要寫一次。
 *
 * 三層防護，各擋不同的情況：
 *   1. runningTasks   同一行程內上一輪還沒跑完 —— 每分鐘一次的排程最常撞到
 *   2. Redis 鎖        多個 scheduler 實例同時醒來 —— 滾動部署的空窗期會發生
 *   3. timeout        工作卡死 —— 沒有它，鎖會被佔到下次部署
 */
@Injectable()
export class TaskRunner {
  private readonly logger = new Logger('Task');
  private readonly fileLogger;

  private readonly active: boolean;
  private readonly runningTasks = new Set<string>();
  private readonly lastExecution = new Map<string, Date>();

  constructor(
    private readonly envService: EnvService,
    private readonly redisService: RedisService,
    logRecorderService: LogRecorderService
  ) {
    this.fileLogger = logRecorderService.createLogger('task');
    this.active = this.envService.isTaskActive();

    this.logger.log(`⏱️  TaskRunner 啟動，總開關: ${this.active ? '啟用' : '停用'}`);
    if (!this.active) return;

    for (const [key, def] of Object.entries(TASK_DEFS)) {
      const enabled = this.isScheduleEnabled(key as TaskKey);
      this.logger.log(`${enabled ? '✅' : '⏸️ '} ${def.label} (${key}): ${def.cron}`);
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 個別排程是否啟用(yaml 的 task.schedule.<key>) */
  public isScheduleEnabled(key: TaskKey): boolean {
    return this.envService.getTaskSchedule()[key] === true;
  }

  public isRunning(key: TaskKey): boolean {
    return this.runningTasks.has(key);
  }

  public getLastExecution(key: TaskKey): Date | undefined {
    return this.lastExecution.get(key);
  }

  /**
   * 執行一支排程。
   * @param key    排程名稱
   * @param jobFn  實際工作
   * @param opts.force 手動觸發：略過啟用檢查(但仍受鎖與逾時保護)
   */
  public async run(key: TaskKey, jobFn: () => Promise<TaskOutcome>, opts: { force?: boolean } = {}): Promise<TaskOutcome> {
    const def = TASK_DEFS[key];

    if (!this.active && !opts.force) return { ok: false, skipped: '排程總開關關閉' };
    if (!this.isScheduleEnabled(key) && !opts.force) return { ok: false, skipped: '此排程未啟用' };
    if (this.runningTasks.has(key)) {
      this.logger.warn(`${def.label} 上一輪尚未結束，這次略過`);
      return { ok: false, skipped: '上一輪尚未結束' };
    }

    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // 鎖的存活時間跟著逾時走：工作被 timeout 砍掉時，鎖也會在差不多的時間自己過期
    const lockKey = `lock:task:${key}`;
    const gotLock = await this.redisService.acquire(lockKey, timeoutMs + 30_000);
    if (!gotLock) {
      this.logger.log(`${def.label} 已由其他實例執行，略過`);
      return { ok: false, skipped: '其他實例執行中' };
    }

    const start = Date.now();
    this.runningTasks.add(key);
    this.logger.log(`⏱️  start: ${def.label}`);

    try {
      const result = await Promise.race([
        jobFn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs))
      ]);

      const ms = Date.now() - start;
      this.lastExecution.set(key, new Date());
      this.logger.log(`✅ done: ${def.label} (${ms}ms)`);
      this.fileLogger.info(JSON.stringify({ task: key, label: def.label, ok: true, ms, detail: result.detail ?? null }));

      return result;
    } catch (error: any) {
      const ms = Date.now() - start;
      this.logger.error(`❌ fail: ${def.label} — ${error?.message}`);
      this.fileLogger.error(JSON.stringify({ task: key, label: def.label, ok: false, ms, error: error?.message }));

      return { ok: false, detail: error?.message };
    } finally {
      this.runningTasks.delete(key);
      await this.redisService.del(lockKey);
    }
  }
}
