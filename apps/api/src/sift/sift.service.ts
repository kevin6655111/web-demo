import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { StorageService } from '@/storage/storage.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { EnvService } from '@/env/env.service';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { CRACK_TYPE_DEF, SIFT_PAY_DEFAULT, findByValue, CASE_STATUS_DEF } from '@road-patrol/shared';
import type { AuthUser } from '@app-types/user-auth.type';
import { JudgeCaseDto, ReviewCaseDto, SiftQueryDto, SiftSalaryQueryDto, SiftStatsQueryDto } from './sift.dto';

/** 二篩狀態：與 shared 的 CASE_STATUS_DEF 對齊 */
const STATUS = { UNJUDGED: 0, PASSED: 1, PENDING: 2, DELETED: 3, MISJUDGED: 4 } as const;

/** 判讀員看的預設範圍：還沒判的 */
const GENERAL_DEFAULT = [STATUS.UNJUDGED, STATUS.PENDING];
/** 管理者看的預設範圍：已經判過的 */
const MANAGE_DEFAULT = [STATUS.PASSED, STATUS.DELETED, STATUS.MISJUDGED];

type BatchResult = { done: string[]; skipped: { caseNum: string; message: string }[] };

type SiftRow = {
  id: number;
  caseNum: string | null;
  externalId: string;
  status: number;
  judgedBy: number | null;
  judgedName: string | null;
  reviewedBy: number | null;
  orderId: number | null;
};

/**
 * 二篩。
 *
 * AI 判讀出來的案件要先經人工確認才算數，分兩層：
 *   判讀員看圖決定「是不是真的破壞」(`upd_status_usr`)
 *   管理者覆核，可以推翻(`upd_status_adm`)
 *
 * 兩層分開記錄，管理者的紀錄不會被判讀員的後續操作蓋掉 ——
 * 薪資與品質統計都要看「誰判的、後來被推翻了沒有」。
 *
 * 這個模組不新增資料表：二篩結果本來就是案件狀態的一部分，
 * 另存一份只會讓「案件現在是什麼狀態」有兩個答案。
 */
@Injectable()
export class SiftService {
  private readonly logger = new Logger('Sift');

  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(PatrolCaseStatus) private readonly statusRepo: Repository<PatrolCaseStatus>,
    private readonly storageService: StorageService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly envService: EnvService,
    private readonly dataSource: DataSource
  ) {}

  // ─── 清單 ──────────────────────────────────────────────────────

  /** 二篩清單；判讀與覆核共用，差別只在預設的狀態範圍 */
  public async list(dto: SiftQueryDto, companyId: number): Promise<HttpResult> {
    const page = dto.PAGE ?? 1;
    const size = dto.SIZE ?? 50;

    const qb = this.buildQuery(dto, companyId)
      .leftJoinAndSelect('st.updStatusUsr', 'judged')
      .leftJoinAndSelect('st.updStatusAdm', 'reviewed')
      // 舊的先判：判讀是有時效的，越久沒判的案件越可能已經被修掉或惡化。
      // 排序用實體屬性名而不是欄位名 —— 與 skip/take 併用時，
      // TypeORM 會拿它去查 metadata，用欄位名會在執行期炸掉
      .orderBy('c.dtRecord', 'ASC')
      .skip((page - 1) * size)
      .take(size);

    const [rows, total] = await qb.getManyAndCount();

    return HttpResponse.successOrWarn({
      data: {
        TOTAL: total,
        PAGE: page,
        SIZE: size,
        ROWS: await Promise.all(
          rows.map(async (c) => ({
            ID: c.id,
            CASE_NUM: c.caseNum ?? c.externalId,
            EXTERNAL_ID: c.externalId,
            DT_RECORD: c.dtRecord,
            CAR: c.car ?? null,
            PRJ_ID: c.project?.prjId ?? null,
            CRACK_TYPE: c.crackType,
            CRACK_TYPE_NAME: CRACK_TYPE_DEF.find((t) => t.key === c.crackType)?.name ?? c.crackType,
            DEGREE: c.degree,
            LENGTH: c.length,
            WIDTH: c.width,
            AREA: c.area,
            COUNTY: c.address?.county ?? null,
            DISTRICT: c.address?.district ?? null,
            ROAD: c.address?.road ?? null,
            ADDRESS: c.address?.address ?? null,
            LNG: c.longitude,
            LAT: c.latitude,
            STATUS: c.status?.status ?? 0,
            STATUS_NAME: findByValue(CASE_STATUS_DEF, c.status?.status ?? 0)?.name ?? '',
            JUDGED_BY: c.status?.updStatusUsr?.name ?? null,
            JUDGED_AT: c.status?.updStatusUsrAt ?? null,
            REVIEWED_BY: c.status?.updStatusAdm?.name ?? null,
            REVIEWED_AT: c.status?.updStatusAdmAt ?? null,
            // 判讀要看圖：原圖與 AI 標註圖各一張，兩張都要能點開比對
            IMG_URL: c.img ? await this.storageService.signGetUrl(c.img, 600) : null,
            IMG_DETECT_URL: c.imgDetect ? await this.storageService.signGetUrl(c.imgDetect, 600) : null
          }))
        )
      },
      isEmpty: (v) => !v?.ROWS?.length,
      warnMsg: dto.TYPE === 'MANAGE' ? '沒有待覆核的案件' : '沒有待判讀的案件'
    });
  }

  private buildQuery(dto: SiftQueryDto, companyId: number): SelectQueryBuilder<PatrolCase> {
    const qb = this.caseRepo
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.status', 'st')
      .leftJoinAndSelect('c.address', 'addr')
      .leftJoinAndSelect('c.project', 'p')
      .where('c.company_id = :companyId', { companyId });

    const statuses = dto.STATUS?.length ? dto.STATUS : dto.TYPE === 'MANAGE' ? MANAGE_DEFAULT : GENERAL_DEFAULT;
    qb.andWhere('st.status IN (:...statuses)', { statuses });

    if (dto.START_DATE) qb.andWhere('c.dt_record >= :start', { start: new Date(dto.START_DATE) });
    if (dto.END_DATE) qb.andWhere('c.dt_record < :end', { end: new Date(`${dto.END_DATE}T23:59:59.999`) });
    if (dto.COUNTY) qb.andWhere('addr.county = :county', { county: dto.COUNTY });
    if (dto.DISTRICT?.length) qb.andWhere('addr.district IN (:...district)', { district: dto.DISTRICT });
    if (dto.PRJ_ID?.length) qb.andWhere('p.prj_id IN (:...prjId)', { prjId: dto.PRJ_ID });
    if (dto.CAR) qb.andWhere('c.car ILIKE :car', { car: `%${dto.CAR}%` });
    if (dto.CRACK_TYPE?.length) qb.andWhere('c.crack_type IN (:...crackType)', { crackType: dto.CRACK_TYPE });
    if (dto.DEGREE?.length) qb.andWhere('c.degree IN (:...degree)', { degree: dto.DEGREE });
    if (dto.JUDGED_BY) qb.andWhere('st.upd_status_usr = :judgedBy', { judgedBy: dto.JUDGED_BY });
    if (dto.UNREVIEWED) qb.andWhere('st.upd_status_adm IS NULL');

    return qb;
  }

  // ─── 判定與覆核 ────────────────────────────────────────────────

  /**
   * 判定(判讀員)。
   *
   * 只能判「還沒判的」：已經判過的要走覆核，否則判讀員可以自己把
   * 被管理者推翻的結果再改回來，而薪資是按判定量計價的。
   */
  public async judge(dto: JudgeCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    return await this.apply(dto, user, 'JUDGE', clientIp);
  }

  /**
   * 覆核(管理者)。
   *
   * 只能覆核「已經判過的」：沒有人判過的案件不存在「推翻」這件事，
   * 那是判定而不是覆核 —— 混在一起的話，統計上會看到沒有判讀員的覆核紀錄。
   */
  public async review(dto: ReviewCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    return await this.apply(dto, user, 'REVIEW', clientIp);
  }

  private async apply(
    dto: JudgeCaseDto,
    user: AuthUser,
    mode: 'JUDGE' | 'REVIEW',
    clientIp?: string
  ): Promise<HttpResult> {
    const ids = [...new Set(dto.IDS)];
    if (!ids.length) throw new BadRequestException('未指定案件');

    const result = await this.dataSource.transaction(async (manager) => {
      const rows = await manager
        .getRepository(PatrolCase)
        .createQueryBuilder('c')
        .innerJoin('c.status', 'st')
        .leftJoin(WorkOrder, 'wo', 'wo.case_patrol_id = c.id')
        .select('c.id', 'id')
        .addSelect('COALESCE(c.case_num, c.external_id)', 'caseNum')
        .addSelect('c.external_id', 'externalId')
        .addSelect('st.status', 'status')
        .addSelect('st.upd_status_usr', 'judgedBy')
        .addSelect('st.upd_status_adm', 'reviewedBy')
        .addSelect('wo.id', 'orderId')
        .where('c.id IN (:...ids)', { ids })
        .andWhere('c.company_id = :companyId', { companyId: user.companyId })
        .getRawMany<SiftRow>();

      const batch: BatchResult = { done: [], skipped: [] };
      const targets: SiftRow[] = [];

      const missing = ids.filter((id) => !rows.some((r) => Number(r.id) === id));
      for (const id of missing) batch.skipped.push({ caseNum: `#${id}`, message: '找不到或不屬於本單位' });

      for (const row of rows) {
        const reason = this.rejectReason(row, mode);
        if (reason) {
          batch.skipped.push({ caseNum: row.caseNum ?? row.externalId, message: reason });
          continue;
        }
        targets.push(row);
      }

      if (targets.length) {
        const now = new Date();
        const patch =
          mode === 'JUDGE'
            ? { status: dto.STATUS, updStatusUsr: { id: user.uid }, updStatusUsrAt: now }
            : { status: dto.STATUS, updStatusAdm: { id: user.uid }, updStatusAdmAt: now };

        await manager
          .getRepository(PatrolCaseStatus)
          .createQueryBuilder()
          .update()
          .set(patch as never)
          .where('case_id IN (:...ids)', { ids: targets.map((t) => Number(t.id)) })
          .execute();

        // 歷程一次寫完：五十筆逐筆寫就是五十個交易
        await this.caseHistoryService.recordMany(
          targets.map((t) => ({
            caseType: 'CASE_PATROL' as const,
            caseId: Number(t.id),
            action: 'STATUS_CHANGED' as const,
            snapshot: { caseNum: t.caseNum, status: dto.STATUS },
            fromState: String(t.status),
            toState: String(dto.STATUS),
            operatorId: user.uid,
            note: [mode === 'JUDGE' ? '二篩判定' : '二篩覆核', dto.REMARK].filter(Boolean).join('：'),
            clientIp
          }))
        );

        batch.done = targets.map((t) => t.caseNum ?? t.externalId);
      }

      return batch;
    });

    const verb = mode === 'JUDGE' ? '判定' : '覆核';
    const message = this.composeMessage(result, verb, findByValue(CASE_STATUS_DEF, dto.STATUS)?.name ?? '');

    return HttpResponse.successOrWarn({
      data: { DONE: result.done, SKIPPED: result.skipped },
      okMsg: message,
      warnMsg: message,
      isEmpty: () => result.skipped.length > 0
    });
  }

  /**
   * 不能動的理由。
   *
   * 「已派工的不能再改」是這裡最重要的一條：派工是根據二篩通過來的，
   * 事後說「其實是誤判」會讓一張正在施工的派工單失去依據 ——
   * 現場的人已經去了，而系統上找不到他為什麼要去。
   */
  private rejectReason(row: SiftRow, mode: 'JUDGE' | 'REVIEW'): string | null {
    if (row.orderId) return '已開立派工單，不可再更改二篩結果';

    if (mode === 'JUDGE') {
      if (row.reviewedBy) return '已經管理者覆核，判讀員不可再更改';
      if (!GENERAL_DEFAULT.includes(row.status as never)) return '已判定過，請走覆核';
      return null;
    }

    if (!row.judgedBy) return '尚未經判讀員判定，不可覆核';
    return null;
  }

  private composeMessage(result: BatchResult, verb: string, statusName: string): string {
    const MAX_LISTED = 5;
    const { done, skipped } = result;

    const head = done.length ? `已${verb} ${done.length} 筆為「${statusName}」` : `沒有案件被${verb}`;
    if (!skipped.length) return `${head}：${done.join('、')}`;

    const lines = skipped.slice(0, MAX_LISTED).map((s) => `・${s.caseNum} ${s.message}`);
    if (skipped.length > MAX_LISTED) lines.push(`…另有 ${skipped.length - MAX_LISTED} 筆`);

    return [head, `${skipped.length} 筆未${verb}`, ...lines].join('\n');
  }

  // ─── 統計 ──────────────────────────────────────────────────────

  /** 二篩統計：判定量、通過率、被推翻率 */
  public async stats(dto: SiftStatsQueryDto, companyId: number): Promise<HttpResult> {
    const GROUP_EXPR: Record<string, string> = {
      DAY: "to_char(date_trunc('day', st.upd_status_usr_at), 'YYYY-MM-DD')",
      USER: "COALESCE(u.name, '未判定')",
      COUNTY: "COALESCE(addr.county, '未定位')",
      DISTRICT: "COALESCE(addr.district, '未分區')",
      CRACK_TYPE: 'c.crack_type'
    };

    const expr = GROUP_EXPR[dto.GROUP_BY ?? 'USER'];

    const qb = this.buildQuery({ ...dto, TYPE: 'MANAGE' } as SiftQueryDto, companyId)
      .leftJoin('st.updStatusUsr', 'u')
      .select(expr, 'GROUP_KEY')
      .addSelect('COUNT(*)::int', 'TOTAL')
      .addSelect(`COUNT(*) FILTER (WHERE st.status = ${STATUS.PASSED})::int`, 'PASSED')
      .addSelect(`COUNT(*) FILTER (WHERE st.status = ${STATUS.MISJUDGED})::int`, 'MISJUDGED')
      .addSelect(`COUNT(*) FILTER (WHERE st.status = ${STATUS.DELETED})::int`, 'DELETED')
      .addSelect('COUNT(*) FILTER (WHERE st.upd_status_adm IS NOT NULL)::int', 'REVIEWED')
      .groupBy(expr)
      .limit(200);

    if (['DAY'].includes(dto.GROUP_BY ?? '')) qb.orderBy('"GROUP_KEY"', 'ASC');
    else qb.orderBy('"TOTAL"', 'DESC');

    const rows = await qb.getRawMany<{ GROUP_KEY: string; TOTAL: number; PASSED: number; MISJUDGED: number }>();

    return HttpResponse.successOrWarn({
      data: rows.map((r) => ({
        ...r,
        // 通過率是品質指標：一個人如果什麼都判通過，這個數字會接近 100%
        PASS_RATE: r.TOTAL ? Math.round((r.PASSED / r.TOTAL) * 100) : 0
      }))
    });
  }

  /**
   * 薪資表。
   *
   * 判定一件計一筆單價；被管理者覆核為誤判的，扣一筆錯誤價。
   * **扣款高於單價是刻意的**：亂按通過比不按更糟 —— 錯的案件會被派工，
   * 現場的人白跑一趟，而那個成本遠高於一件判讀的單價。
   *
   * 只算判讀員(`upd_status_usr`)的量；管理者的覆核不計價。
   */
  public async salary(dto: SiftSalaryQueryDto, companyId: number): Promise<HttpResult> {
    if (!/^\d{4}-\d{2}$/.test(dto.MONTH)) throw new BadRequestException('MONTH 格式應為 YYYY-MM');

    const start = new Date(`${dto.MONTH}-01T00:00:00`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const { unitPrice, errorPrice } = this.envService.getAppConfig().sift ?? SIFT_PAY_DEFAULT;

    const qb = this.statusRepo
      .createQueryBuilder('st')
      .innerJoin('st.patrolCase', 'c')
      .innerJoin('st.updStatusUsr', 'u')
      .select('u.id', 'USER_ID')
      .addSelect('u.name', 'USER_NAME')
      .addSelect('u.employee_no', 'EMPLOYEE_NO')
      .addSelect('COUNT(*)::int', 'JUDGED')
      // 「被推翻」的定義：管理者覆核過，而且結論是誤判
      .addSelect(
        `COUNT(*) FILTER (WHERE st.upd_status_adm IS NOT NULL AND st.status = ${STATUS.MISJUDGED})::int`,
        'OVERTURNED'
      )
      .where('c.company_id = :companyId', { companyId })
      .andWhere('st.upd_status_usr_at >= :start AND st.upd_status_usr_at < :end', { start, end })
      .groupBy('u.id')
      .addGroupBy('u.name')
      .addGroupBy('u.employee_no')
      .orderBy('"JUDGED"', 'DESC');

    if (dto.USER_ID) qb.andWhere('u.id = :userId', { userId: dto.USER_ID });

    const rows = await qb.getRawMany<{
      USER_ID: number;
      USER_NAME: string;
      EMPLOYEE_NO: string | null;
      JUDGED: number;
      OVERTURNED: number;
    }>();

    const detail = rows.map((r) => {
      const gross = r.JUDGED * unitPrice;
      const deduction = r.OVERTURNED * errorPrice;

      return {
        ...r,
        UNIT_PRICE: unitPrice,
        ERROR_PRICE: errorPrice,
        GROSS: Number(gross.toFixed(2)),
        DEDUCTION: Number(deduction.toFixed(2)),
        NET: Number((gross - deduction).toFixed(2)),
        ACCURACY: r.JUDGED ? Math.round(((r.JUDGED - r.OVERTURNED) / r.JUDGED) * 100) : 100
      };
    });

    return HttpResponse.successOrWarn({
      data: {
        MONTH: dto.MONTH,
        UNIT_PRICE: unitPrice,
        ERROR_PRICE: errorPrice,
        ROWS: detail,
        TOTAL_JUDGED: detail.reduce((s, r) => s + r.JUDGED, 0),
        TOTAL_NET: Number(detail.reduce((s, r) => s + r.NET, 0).toFixed(2))
      },
      isEmpty: (v) => !v?.ROWS?.length,
      warnMsg: '這個月沒有判定紀錄'
    });
  }
}
