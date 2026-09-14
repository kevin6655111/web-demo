import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RedisService } from '@/redis/redis.service';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { DailyCheck } from './entities/daily-check.entity';
import { DashboardCaseStat } from './entities/dashboard-case-stat.entity';
import { DashboardOrderStat } from './entities/dashboard-order-stat.entity';
import { DailyCheckQueryDto, SettlementQueryDto } from './dashboard.dto';

const CACHE_TTL_MS = 60_000;

/**
 * 儀表板。
 *
 * 每一塊都是一句話能講完的問題，而不是「把所有數字都撈出來」：
 *   KPI    今天進來多少、還有多少沒處理、修完的比例、平均花多久
 *   趨勢    這兩週每天的量，看得出週末與雨天
 *   分布    哪一種破壞最多，決定要買哪種料
 *   熱區    哪幾條路最常出事，決定要不要整段刨鋪
 *   時效    逾期未完工的單，這是唯一需要立刻有人動作的區塊
 *
 * 整包查詢快取 60 秒：看板通常掛在牆上整天刷新，
 * 沒有必要讓每次刷新都打六個聚合查詢。
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(WorkOrder) private readonly workOrderRepo: Repository<WorkOrder>,
    @InjectRepository(DailyCheck) private readonly dailyCheckRepo: Repository<DailyCheck>,
    @InjectRepository(DashboardCaseStat) private readonly caseStatRepo: Repository<DashboardCaseStat>,
    @InjectRepository(DashboardOrderStat) private readonly orderStatRepo: Repository<DashboardOrderStat>,
    private readonly redisService: RedisService
  ) {}

  /**
   * 每日上傳檢查。
   *
   * 督導早上開的第一個畫面。預設看昨天 —— 今天的資料還在進來，
   * 現在說「這台車今天只上傳三筆」沒有意義。
   */
  public async getDailyCheck(dto: DailyCheckQueryDto, companyId: number): Promise<HttpResult> {
    const date = dto.DATE ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const qb = this.dailyCheckRepo
      .createQueryBuilder('d')
      .leftJoin('d.project', 'p')
      .select('d.car', 'CAR')
      .addSelect("COALESCE(p.prj_id, '未歸屬')", 'PRJ_ID')
      .addSelect("COALESCE(d.district, '未分區')", 'DISTRICT')
      .addSelect('d.case_count', 'CASE_COUNT')
      .addSelect('d.image_total', 'IMAGE_TOTAL')
      .addSelect('d.image_missing', 'IMAGE_MISSING')
      .addSelect('d.track_points', 'TRACK_POINTS')
      .addSelect('d.first_at', 'FIRST_AT')
      .addSelect('d.last_at', 'LAST_AT')
      .addSelect('d.note', 'NOTE')
      .addSelect('d.checked_at', 'CHECKED_AT')
      .where('d.company_id = :companyId', { companyId })
      .andWhere('d.check_date = :date', { date })
      .orderBy('d.car', 'ASC')
      .addOrderBy('d.district', 'ASC');

    if (dto.CAR) qb.andWhere('d.car ILIKE :car', { car: `%${dto.CAR}%` });
    if (dto.PROJECT_ID) qb.andWhere('d.project_id = :projectId', { projectId: dto.PROJECT_ID });
    // 「有問題」的定義寫在 SQL 裡而不是撈回來再過濾：不然分頁與計數都會錯
    if (dto.ABNORMAL_ONLY) qb.andWhere("d.note IS DISTINCT FROM '正常'");

    const rows = await qb.getRawMany<{ CASE_COUNT: number; IMAGE_MISSING: number; TRACK_POINTS: number; NOTE: string }>();

    return HttpResponse.successOrWarn({
      data: {
        DATE: date,
        ROWS: rows,
        CARS: rows.length,
        CASE_TOTAL: rows.reduce((s, r) => s + Number(r.CASE_COUNT), 0),
        IMAGE_MISSING: rows.reduce((s, r) => s + Number(r.IMAGE_MISSING), 0),
        ABNORMAL: rows.filter((r) => r.NOTE !== '正常').length
      },
      isEmpty: (v) => !v?.ROWS?.length,
      warnMsg: '這一天還沒有檢查結果；檢查由「每日檢查上傳狀態」排程每小時產生'
    });
  }

  /**
   * 結算查詢。
   *
   * 讀統計表而不是即時算 —— 這一支是報表與看板的歷史區間在用的，
   * 而即時算要掃整月的軌跡點。統計由 `dashboardSync` 排程產生。
   */
  public async getSettlement(dto: SettlementQueryDto, companyId: number): Promise<HttpResult> {
    const GROUP_EXPR: Record<string, string> = {
      DAY: 's.stat_date::text',
      DISTRICT: "COALESCE(s.district, '未分區')",
      PROJECT: "COALESCE(p.prj_id, '未歸屬')"
    };
    const expr = GROUP_EXPR[dto.GROUP_BY ?? 'DAY'];

    const cases = await this.caseStatRepo
      .createQueryBuilder('s')
      .leftJoin('s.project', 'p')
      .select(expr, 'GROUP_KEY')
      .addSelect('ROUND(SUM(s.mileage_km)::numeric, 2)::float8', 'MILEAGE_KM')
      .addSelect('SUM(s.patrol_days)::int', 'PATROL_DAYS')
      .addSelect('SUM(s.case_total)::int', 'CASE_TOTAL')
      .addSelect('SUM(s.pothole)::int', 'POTHOLE')
      .addSelect('SUM(s.alligator_crack)::int', 'ALLIGATOR')
      .addSelect('SUM(s.linear_crack)::int', 'LINEAR')
      .addSelect('SUM(s.patch)::int', 'PATCH')
      .addSelect('SUM(s.manhole_cover)::int', 'COVER')
      .addSelect('SUM(s.other_crack)::int', 'OTHER')
      .addSelect('ROUND(SUM(s.area_m2)::numeric, 2)::float8', 'AREA')
      .where('s.company_id = :companyId', { companyId })
      .andWhere('s.stat_date BETWEEN :start AND :end', { start: dto.DATE_START, end: dto.DATE_END })
      .andWhere(dto.PROJECT_ID ? 's.project_id = :projectId' : '1=1', { projectId: dto.PROJECT_ID })
      .andWhere(dto.DISTRICT ? 's.district = :district' : '1=1', { district: dto.DISTRICT })
      .groupBy(expr)
      .orderBy('"GROUP_KEY"', 'ASC')
      .getRawMany();

    const orders = await this.orderStatRepo
      .createQueryBuilder('s')
      .leftJoin('s.project', 'p')
      .select(expr, 'GROUP_KEY')
      .addSelect('SUM(s.dispatched)::int', 'DISPATCHED')
      .addSelect('SUM(s.in_progress)::int', 'IN_PROGRESS')
      .addSelect('SUM(s.reported)::int', 'REPORTED')
      .addSelect('SUM(s.done)::int', 'DONE')
      .addSelect('SUM(s.overdue)::int', 'OVERDUE')
      .where('s.company_id = :companyId', { companyId })
      .andWhere('s.stat_date BETWEEN :start AND :end', { start: dto.DATE_START, end: dto.DATE_END })
      .andWhere(dto.PROJECT_ID ? 's.project_id = :projectId' : '1=1', { projectId: dto.PROJECT_ID })
      .andWhere(dto.DISTRICT ? 's.district = :district' : '1=1', { district: dto.DISTRICT })
      .groupBy(expr)
      .orderBy('"GROUP_KEY"', 'ASC')
      .getRawMany();

    return HttpResponse.successOrWarn({
      data: {
        GROUP_BY: dto.GROUP_BY ?? 'DAY',
        CASES: cases,
        ORDERS: orders,
        TOTAL_KM: Number(cases.reduce((s: number, r: any) => s + Number(r.MILEAGE_KM), 0).toFixed(2)),
        TOTAL_CASES: cases.reduce((s: number, r: any) => s + Number(r.CASE_TOTAL), 0),
        TOTAL_DONE: orders.reduce((s: number, r: any) => s + Number(r.DONE), 0)
      },
      isEmpty: (v) => !v?.CASES?.length && !v?.ORDERS?.length,
      warnMsg: '這個區間還沒有結算資料；結算由「儀表板結算」排程每日產生'
    });
  }

  public async getOverview(companyId: number): Promise<HttpResult> {
    const cacheKey = `dashboard:overview:${companyId}`;

    const cached = await this.redisService.getJson<Record<string, unknown>>(cacheKey);
    if (cached) return HttpResponse.success({ data: { ...cached, CACHED: true } });

    const [kpi, trend, byType, hotspots, pending, recent] = await Promise.all([
      this.getKpi(companyId),
      this.getTrend(companyId),
      this.getTypeDistribution(companyId),
      this.getHotspots(companyId),
      this.getOverdue(companyId),
      this.getRecentCases(companyId)
    ]);

    const data = {
      KPI: kpi,
      TREND: trend,
      BY_TYPE: byType,
      HOTSPOTS: hotspots,
      OVERDUE: pending,
      RECENT: recent,
      CACHED: false
    };
    await this.redisService.setJson(cacheKey, data, CACHE_TTL_MS);

    return HttpResponse.success({ data });
  }

  /**
   * KPI：今日新增、待派工、完修率、平均修復時數。
   *
   * 狀態在 patrol_case_statuses：主表只放車機寫進來的內容，
   * 人改的狀態放另一張表 —— 否則車機的大量寫入會跟人的編輯搶同一列。
   */
  private async getKpi(companyId: number) {
    // 「完修」看的是派工單完工(status=3)，不是案件狀態 ——
    // 案件的 needRepair 只有 待確認/觀察中/已派工/已刪除，沒有「已完修」這個值。
    // 修完了是派工單的事實，硬塞回案件會讓同一個欄位表達兩件事
    const row = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoin('c.status', 'st')
      .leftJoin(WorkOrder, 'w', 'w.case_patrol_id = c.id')
      .leftJoin('w.status', 'ws')
      .select('COUNT(*)::int', 'total')
      .addSelect("COUNT(*) FILTER (WHERE c.dt_record >= date_trunc('day', now()))::int", 'today')
      .addSelect('COUNT(*) FILTER (WHERE COALESCE(st.need_repair, 0) IN (0, 1))::int', 'pending')
      .addSelect('COUNT(*) FILTER (WHERE st.need_repair = 2)::int', 'dispatched')
      .addSelect('COUNT(*) FILTER (WHERE ws.status = 3)::int', 'repaired')
      .where('c.company_id = :companyId', { companyId })
      .getRawOne<{ total: number; today: number; pending: number; dispatched: number; repaired: number }>();

    // 平均修復時數：從案件被拍到，到派工單完工驗收之間
    const avg = await this.workOrderRepo
      .createQueryBuilder('w')
      .innerJoin('w.casePatrol', 'c')
      .innerJoin('w.status', 'ws')
      .select('AVG(EXTRACT(EPOCH FROM (ws.upd_status_at - c.dt_record)) / 3600)', 'hours')
      .where('w.company_id = :companyId', { companyId })
      .andWhere('ws.status = 3')
      .getRawOne<{ hours: string | null }>();

    const total = row?.total ?? 0;

    return {
      TOTAL: total,
      TODAY: row?.today ?? 0,
      PENDING: row?.pending ?? 0,
      DISPATCHED: row?.dispatched ?? 0,
      REPAIRED: row?.repaired ?? 0,
      REPAIR_RATE: total ? Math.round(((row?.repaired ?? 0) / total) * 100) : 0,
      AVG_REPAIR_HOURS: avg?.hours ? Number(Number(avg.hours).toFixed(1)) : null
    };
  }

  /** 近 14 日趨勢 */
  private async getTrend(companyId: number) {
    // generate_series 補齊沒有案件的日子：折線圖不該因為某天沒資料就跳過那一格
    return await this.caseRepo.query(
      `
      SELECT to_char(d.day, 'MM-DD')                            AS "DAY",
             COUNT(c.id)::int                                   AS "TOTAL",
             COUNT(c.id) FILTER (WHERE ws.status = 3)::int AS "REPAIRED"
        FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d(day)
        LEFT JOIN patrol_cases c
               ON c.company_id = $1
              AND c.dt_record >= d.day
              AND c.dt_record <  d.day + interval '1 day'
        LEFT JOIN work_orders w ON w.case_patrol_id = c.id
        LEFT JOIN work_order_statuses ws ON ws.work_order_id = w.id
       GROUP BY d.day
       ORDER BY d.day
      `,
      [companyId]
    );
  }

  /** 破壞類型分布 */
  private async getTypeDistribution(companyId: number) {
    return await this.caseRepo
      .createQueryBuilder('c')
      .select('c.crack_type', 'TYPE')
      .addSelect('COUNT(*)::int', 'COUNT')
      .addSelect('ROUND(SUM(c.area)::numeric, 2)::float8', 'AREA')
      .where('c.company_id = :companyId', { companyId })
      .groupBy('c.crack_type')
      .orderBy('"COUNT"', 'DESC')
      .getRawMany();
  }

  /** 熱區：案件最多的前 8 條路 */
  private async getHotspots(companyId: number) {
    return await this.caseRepo
      .createQueryBuilder('c')
      .innerJoin('c.address', 'ad')
      .leftJoin('c.status', 'st')
      .select('ad.road', 'ROAD')
      .addSelect('COUNT(*)::int', 'COUNT')
      .addSelect('COUNT(*) FILTER (WHERE COALESCE(st.need_repair, 0) IN (0, 1))::int', 'PENDING')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('ad.road IS NOT NULL')
      .groupBy('ad.road')
      .orderBy('"COUNT"', 'DESC')
      .limit(8)
      .getRawMany();
  }

  /** 逾期未完工的派工單 */
  private async getOverdue(companyId: number) {
    return await this.workOrderRepo
      .createQueryBuilder('w')
      // 一張單可以派多人：把名字串成一欄，而不是讓同一張單在逾期清單上出現三次 ——
      // 這份清單是要拿去催工的，重複的列會讓人以為逾期比實際多
      .leftJoin('w.workers', 'wk')
      .leftJoin('wk.user', 'a')
      .innerJoin('w.status', 'ws')
      .select('w.id', 'ID')
      .addSelect('w.case_num', 'ORDER_NO')
      .addSelect('w.address', 'ROAD')
      .addSelect("STRING_AGG(a.name, '、' ORDER BY a.name)", 'ASSIGNEE')
      .addSelect('w.due_date', 'DUE_AT')
      .addSelect('EXTRACT(EPOCH FROM (now() - w.due_date)) / 3600', 'OVERDUE_HOURS')
      .where('w.company_id = :companyId', { companyId })
      .andWhere('ws.status IN (0, 1, 2)')
      .andWhere('w.due_date < CURRENT_DATE')
      .groupBy('w.id')
      .addGroupBy('ws.status')
      .orderBy('w.due_date', 'ASC')
      .limit(10)
      .getRawMany();
  }

  /** 最新案件(看板右側的即時清單，WebSocket 推播來的新案件會插在最前面) */
  private async getRecentCases(companyId: number) {
    return await this.caseRepo
      .createQueryBuilder('c')
      .leftJoin('c.address', 'ad')
      .leftJoin('c.status', 'st')
      .select('c.id', 'ID')
      .addSelect('c.case_num', 'CASE_NUM')
      .addSelect('c.external_id', 'EXTERNAL_ID')
      .addSelect('c.crack_type', 'CRACK_TYPE')
      .addSelect('c.degree', 'DEGREE')
      .addSelect('COALESCE(st.status, 0)', 'STATUS')
      .addSelect('COALESCE(st.need_repair, 0)', 'NEED_REPAIR')
      .addSelect('ad.road', 'ROAD_NAME')
      .addSelect('ad.address', 'ADDRESS')
      .addSelect('c.dt_record', 'DETECTED_AT')
      .addSelect('c.longitude', 'LNG')
      .addSelect('c.latitude', 'LAT')
      .where('c.company_id = :companyId', { companyId })
      .orderBy('c.dt_record', 'DESC')
      .limit(12)
      .getRawMany();
  }
}
