import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RedisService } from '@/redis/redis.service';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';

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
    private readonly redisService: RedisService
  ) {}

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

    const data = { KPI: kpi, TREND: trend, BY_TYPE: byType, HOTSPOTS: hotspots, OVERDUE: pending, RECENT: recent, CACHED: false };
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
      .leftJoin('w.workerUser', 'a')
      .innerJoin('w.status', 'ws')
      .select('w.id', 'ID')
      .addSelect('w.case_num', 'ORDER_NO')
      .addSelect('w.address', 'ROAD')
      .addSelect('a.name', 'ASSIGNEE')
      .addSelect('w.due_date', 'DUE_AT')
      .addSelect('EXTRACT(EPOCH FROM (now() - w.due_date)) / 3600', 'OVERDUE_HOURS')
      .where('w.company_id = :companyId', { companyId })
      .andWhere('ws.status IN (0, 1, 2)')
      .andWhere('w.due_date < CURRENT_DATE')
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
