import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EnvService } from '@/env/env.service';
import { RedisService } from '@/redis/redis.service';
import { GeoService } from '@/geo/geo.service';
import { TilesService } from '@/tiles/tiles.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { ReportJob } from '@/report/entities/report-job.entity';
import { Company } from '@entities/company.entity';
import { TaskRunner, TASK_STATUS_KEY, type TaskOutcome } from './task-runner';
import { TASK_DEFS, type TaskKey } from './task-definitions';

/**
 * 排程實作。
 *
 * 每一支都是「掃一遍、補齊、記下來」的形狀，而且都能重複執行 ——
 * 排程沒有人盯著，重跑一次不該產生第二份結果。
 *
 * 與正式站台的差異寫在各自的註解裡(備份、通知這類需要外部系統的，
 * Demo 只做到「算出該做什麼」而不真的送出去)。
 */
@Injectable()
export class TaskService implements OnModuleInit {
  private readonly logger = new Logger('TaskService');

  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(PatrolCaseAddress) private readonly addressRepo: Repository<PatrolCaseAddress>,
    @InjectRepository(WorkOrder) private readonly workOrderRepo: Repository<WorkOrder>,
    @InjectRepository(ReportJob) private readonly reportRepo: Repository<ReportJob>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    private readonly envService: EnvService,
    private readonly redisService: RedisService,
    private readonly geoService: GeoService,
    private readonly tilesService: TilesService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly taskRunner: TaskRunner,
    private readonly schedulerRegistry: SchedulerRegistry
  ) {}

  /** 註冊所有啟用的排程 */
  onModuleInit(): void {
    if (!this.taskRunner.isActive) return;

    for (const key of Object.keys(TASK_DEFS) as TaskKey[]) {
      if (!this.taskRunner.isScheduleEnabled(key)) continue;

      const job = new CronJob(TASK_DEFS[key].cron, () => void this.trigger(key), null, false, 'Asia/Taipei');
      this.schedulerRegistry.addCronJob(key, job as never);
      job.start();
    }

    this.logger.log(`⏰ 排程註冊完成，時區 Asia/Taipei`);
    void this.publishStatus();
  }

  /** 觸發一支排程(手動觸發時 force=true) */
  public async trigger(key: TaskKey, force = false): Promise<TaskOutcome> {
    const result = await this.taskRunner.run(key, () => this.dispatch(key), { force });
    await this.publishStatus();

    return result;
  }

  /**
   * 把狀態寫進 Redis 給 api 讀。
   *
   * 排程跑在自己的行程裡，api 沒有辦法直接問它 ——
   * 與其為此開一個內部 HTTP 埠，不如把狀態放在兩邊都連得到的地方。
   */
  private async publishStatus(): Promise<void> {
    await this.redisService.setJson(TASK_STATUS_KEY, this.getStatus(), 10 * 60_000);
  }

  /** 排程狀態(給維運畫面看：哪些啟用、上次跑完是什麼時候) */
  public getStatus() {
    return (Object.keys(TASK_DEFS) as TaskKey[]).map((key) => ({
      KEY: key,
      LABEL: TASK_DEFS[key].label,
      CRON: TASK_DEFS[key].cron,
      ENABLED: this.taskRunner.isScheduleEnabled(key),
      RUNNING: this.taskRunner.isRunning(key),
      LAST_RUN: this.taskRunner.getLastExecution(key) ?? null
    }));
  }

  private dispatch(key: TaskKey): Promise<TaskOutcome> {
    const handlers: Record<TaskKey, () => Promise<TaskOutcome>> = {
      caseAutoCode: () => this.caseAutoCode(),
      databaseBackup: () => this.databaseBackup(),
      lineNotify: () => this.lineNotify(),
      roadEvalStat: () => this.roadEvalStat(),
      dailyCheck: () => this.dailyCheck(),
      patrolPointCov: () => this.patrolPointCov(),
      addressGeocoder: () => this.addressGeocoder(),
      pathUpdater: () => this.pathUpdater(),
      dashboardSync: () => this.dashboardSync(),
      tilesWarmup: () => this.tilesWarmup(),
      partitionMaintain: () => this.partitionMaintain()
    };

    return handlers[key]();
  }

  // ─── 排程實作 ──────────────────────────────────────────────────

  /**
   * 案件編碼：把還沒歸屬標案的案件掛到當期標案底下。
   * 每分鐘跑一次，所以只處理一小批 —— 讓每輪都能在幾秒內結束。
   */
  private async caseAutoCode(): Promise<TaskOutcome> {
    const rows = await this.caseRepo.query(
      `
      UPDATE patrol_cases c
         SET project_id = p.id
        FROM projects p
       WHERE c.project_id IS NULL
         AND p.company_id = c.company_id
         AND p.state = 'ACTIVE'
         AND c.dt_record::date BETWEEN COALESCE(p.start_date, '-infinity'::date) AND COALESCE(p.end_date, 'infinity'::date)
         AND c.id IN (SELECT id FROM patrol_cases WHERE project_id IS NULL ORDER BY id LIMIT 500)
      RETURNING c.id
      `
    );

    return { ok: true, detail: { coded: rows?.length ?? 0 } };
  }

  /**
   * 資料庫備份。
   * 正式站台是 pg_dump 到物件儲存並輪替保留；Demo 只統計各表列數當作備份前檢查，
   * 因為在容器裡真的寫一份備份檔，對示範沒有幫助卻會把磁碟塞滿。
   */
  private async databaseBackup(): Promise<TaskOutcome> {
    const rows = await this.caseRepo.query(
      `SELECT relname AS table, n_live_tup::int AS rows
         FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY n_live_tup DESC`
    );

    return { ok: true, detail: { tables: rows?.length ?? 0, snapshot: rows } };
  }

  /**
   * 通知推播：找出逾期未完工的派工單。
   * 正式站台會把結果送進 LINE / FCM；Demo 到「算出該通知誰」為止。
   */
  private async lineNotify(): Promise<TaskOutcome> {
    const overdue = await this.workOrderRepo
      .createQueryBuilder('w')
      // 一張單可以派多人 —— 每個人都該收到自己的那一張的通知，
      // 所以這裡是「每個人各一列」，不是把名字串起來
      .leftJoin('w.workers', 'wk')
      .leftJoin('wk.user', 'a')
      .innerJoin('w.status', 'ws')
      .select('a.name', 'assignee')
      .addSelect('COUNT(*)::int', 'count')
      .where('ws.status IN (0, 1, 2)')
      .andWhere('w.due_date < CURRENT_DATE')
      .groupBy('a.name')
      // 沒指派施工人員的逾期單排最前面：那是沒有人在負責的單，最該先看
      .orderBy('a.name', 'ASC', 'NULLS FIRST')
      .getRawMany();

    return { ok: true, detail: { targets: overdue.length, overdue } };
  }

  /** 道路評估統計：以路名彙總案件密度與面積 */
  private async roadEvalStat(): Promise<TaskOutcome> {
    const rows = await this.caseRepo.query(
      `SELECT ad.road AS road,
              COUNT(*)::int AS cases,
              ROUND(SUM(c.area)::numeric, 2)::float8 AS area
         FROM patrol_cases c
         JOIN patrol_case_addresses ad ON ad.case_id = c.id
        WHERE ad.road IS NOT NULL
          AND c.dt_record >= now() - interval '30 days'
        GROUP BY ad.road
        ORDER BY cases DESC
        LIMIT 50`
    );

    return { ok: true, detail: { roads: rows.length, top: rows.slice(0, 5) } };
  }

  /** 每日檢查上傳狀態：確認今天有沒有案件進來(沒有通常代表車機或網路斷了) */
  private async dailyCheck(): Promise<TaskOutcome> {
    const row = await this.caseRepo
      .createQueryBuilder('c')
      .select('COUNT(*)::int', 'today')
      .addSelect('MAX(c.dt_record)', 'lastAt')
      .where("c.dt_record >= date_trunc('day', now())")
      .getRawOne<{ today: number; lastAt: Date | null }>();

    const silentHours = row?.lastAt ? (Date.now() - new Date(row.lastAt).getTime()) / 3_600_000 : null;

    return {
      ok: true,
      detail: {
        today: row?.today ?? 0,
        lastAt: row?.lastAt ?? null,
        // 超過 6 小時沒有新案件就值得看一眼；正式站台會在這裡發告警
        suspicious: silentHours !== null && silentHours > 6
      }
    };
  }

  /** 巡查點覆蓋率統計：每條路的案件處理進度 */
  private async patrolPointCov(): Promise<TaskOutcome> {
    // 完修以派工單的完工狀態為準；案件狀態沒有「已完修」這個值
    const row = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoin('c.address', 'ad')
      .leftJoin(WorkOrder, 'w', 'w.case_patrol_id = c.id')
      .leftJoin('w.status', 'ws')
      .select('COUNT(DISTINCT ad.road)::int', 'roads')
      .addSelect('COUNT(*)::int', 'cases')
      .addSelect('COUNT(*) FILTER (WHERE ws.status = 3)::int', 'repaired')
      .getRawOne<{ roads: number; cases: number; repaired: number }>();

    const coverage = row?.cases ? Math.round((row.repaired / row.cases) * 100) : 0;

    return { ok: true, detail: { ...row, coverage } };
  }

  /**
   * 地址編碼：補上還沒有路名的案件。
   * 佇列那條路徑漏掉的(例如 worker 當時沒起來)，由這支每天兜底。
   */
  private async addressGeocoder(): Promise<TaskOutcome> {
    // 地址在分表，所以「還沒編碼」等於「沒有地址列，或有列但路名是空的」
    const pending = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoin('c.address', 'ad')
      .where('ad.id IS NULL OR ad.road IS NULL')
      .orderBy('c.id', 'ASC')
      .take(500)
      .getMany();

    let filled = 0;
    for (const c of pending) {
      if (c.longitude === undefined || c.latitude === undefined) continue;

      const road = await this.geoService.reverseGeocode(c.longitude, c.latitude);

      const existing = await this.addressRepo.findOne({ where: { patrolCase: { id: c.id } } });
      if (existing) await this.addressRepo.update({ id: existing.id }, { road, address: road, oAddress: road });
      else await this.addressRepo.save(this.addressRepo.create({ patrolCase: { id: c.id }, road, address: road, oAddress: road }));

      await this.caseHistoryService.record({
        caseType: 'CASE_PATROL',
        caseId: c.id,
        action: 'GEOCODED',
        snapshot: { road, address: road },
        source: 'TASK',
        note: road
      });

      filled += 1;
    }

    return { ok: true, detail: { scanned: pending.length, filled } };
  }

  /**
   * 路徑更新：清掉過期的報表檔案紀錄。
   * 報表的下載網址是短效的，工作紀錄留著沒有意義還會讓清單越來越長。
   */
  private async pathUpdater(): Promise<TaskOutcome> {
    const cutoff = new Date(Date.now() - 7 * 86400000);
    const result = await this.reportRepo.delete({ createdAt: LessThan(cutoff) });

    return { ok: true, detail: { removed: result.affected ?? 0 } };
  }

  /** 儀表板結算：清掉快取，讓隔天第一次開看板拿到的是新的數字 */
  private async dashboardSync(): Promise<TaskOutcome> {
    const companies = await this.companyRepo.find();
    for (const c of companies) await this.redisService.del(`dashboard:overview:${c.id}`);

    return { ok: true, detail: { companies: companies.length } };
  }

  /** 圖層快取預熱 */
  private async tilesWarmup(): Promise<TaskOutcome> {
    const companies = await this.companyRepo.find();

    let warmed = 0;
    for (const c of companies) warmed += await this.tilesService.warmup(c.id);

    return { ok: true, detail: { companies: companies.length, layers: warmed } };
  }

  /**
   * 資料表維護。
   * 正式站台在這裡預先建立下一季的分區；Demo 沒有分區表，
   * 改成回收統計資訊 —— 兩者的共同點是「趁沒人用的時候整理資料庫」。
   */
  private async partitionMaintain(): Promise<TaskOutcome> {
    await this.caseRepo.query('ANALYZE patrol_cases');
    await this.caseRepo.query('ANALYZE work_orders');

    const rows = await this.caseRepo.query(
      `SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size
         FROM pg_catalog.pg_statio_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 10`
    );

    return { ok: true, detail: { analyzed: ['patrol_cases', 'work_orders'], sizes: rows } };
  }
}
