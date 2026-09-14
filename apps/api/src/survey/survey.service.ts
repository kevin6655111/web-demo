import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { SurveyOrder, type SurveyOrderState } from './entities/survey-order.entity';
import { SurveyCase, type SurveyCaseState, type SurveyMethod } from './entities/survey-case.entity';
import { SurveyOrderDetail, type SurveyDirection } from './entities/survey-order-detail.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { pciToLevel } from '@/road-eval/road-eval.service';
import { CaseEncodeService } from '@/case-encode/case-encode.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { StorageService } from '@/storage/storage.service';
import { userRef, type AuthUser } from '@app-types/user-auth.type';
import {
  AppSurveyCaseDto,
  ExpertSurveyQueryDto,
  SurveyCaseQueryDto,
  SurveyCaseStatusDto,
  SurveyOrderQueryDto,
  TransferSurveyCaseDto,
  UpsertSurveyCaseDto,
  UpsertSurveyDetailDto,
  UpsertSurveyOrderDto
} from './survey.dto';

@Injectable()
export class SurveyService {
  private readonly logger = new Logger('Survey');

  constructor(
    @InjectRepository(SurveyOrder) private readonly orderRepo: Repository<SurveyOrder>,
    @InjectRepository(SurveyCase) private readonly caseRepo: Repository<SurveyCase>,
    @InjectRepository(SurveyOrderDetail) private readonly detailRepo: Repository<SurveyOrderDetail>,
    @InjectRepository(RoadSegment) private readonly segmentRepo: Repository<RoadSegment>,
    private readonly caseEncodeService: CaseEncodeService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly storageService: StorageService,
    private readonly dataSource: DataSource
  ) {}

  // ─── 委託單 ────────────────────────────────────────────────────

  /** 委託單清單；一併帶出調查點的完成進度 */
  public async listOrders(dto: SurveyOrderQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.surveyor', 'u')
      .leftJoinAndSelect('o.project', 'p')
      .where('o.company_id = :companyId', { companyId })
      .orderBy('o.id', 'DESC');

    if (dto.ORDER_NO) qb.andWhere('o.order_no ILIKE :no', { no: `%${dto.ORDER_NO}%` });
    if (dto.STATE?.length) qb.andWhere('o.state IN (:...state)', { state: dto.STATE });
    if (dto.PROJECT_ID) qb.andWhere('o.project_id = :projectId', { projectId: dto.PROJECT_ID });
    if (dto.DATE_FROM) qb.andWhere('o.created_at >= :from', { from: new Date(dto.DATE_FROM) });
    if (dto.DATE_TO) qb.andWhere('o.created_at < :to', { to: new Date(`${dto.DATE_TO}T23:59:59.999`) });

    const orders = await qb.getMany();
    if (!orders.length) return HttpResponse.warn({ data: [], message: '查無委託單' });

    // 進度一次查完再合併，不要在迴圈裡逐張查(N+1)
    const progress = await this.caseRepo
      .createQueryBuilder('c')
      .select('c.order_id', 'orderId')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect("COUNT(*) FILTER (WHERE c.state = 'DONE')::int", 'done')
      .where('c.order_id IN (:...ids)', { ids: orders.map((o) => o.id) })
      .andWhere('c.deleted_at IS NULL')
      .groupBy('c.order_id')
      .getRawMany<{ orderId: number; total: number; done: number }>();

    const byOrder = new Map(progress.map((p) => [Number(p.orderId), p]));

    // 應取樣數來自明細；沒有明細的委託單以實際點數為準
    const required = await this.detailRepo
      .createQueryBuilder('d')
      .select('d.order_id', 'orderId')
      .addSelect('COUNT(*)::int', 'details')
      .addSelect('SUM(d.sample_count)::int', 'samples')
      .where('d.order_id IN (:...ids)', { ids: orders.map((o) => o.id) })
      .groupBy('d.order_id')
      .getRawMany<{ orderId: number; details: number; samples: number }>();

    const byRequired = new Map(required.map((r) => [Number(r.orderId), r]));

    return HttpResponse.success({
      data: orders.map((o) => {
        const p = byOrder.get(o.id);
        const req = byRequired.get(o.id);
        // 進度的分母是「業主要求的取樣數」而不是「已經排了幾個點」——
        // 後者會讓一張還沒排點的委託單顯示 0/0 = 100%
        const denominator = req?.samples ?? p?.total ?? 0;

        return {
          DETAIL_COUNT: req?.details ?? 0,
          SAMPLE_REQUIRED: req?.samples ?? 0,
          ID: o.id,
          ORDER_NO: o.orderNo,
          TITLE: o.title,
          STATE: o.state,
          REQUESTER: o.requester ?? null,
          SURVEYOR: o.surveyor?.name ?? null,
          SURVEYOR_ID: o.surveyor?.id ?? null,
          PROJECT: o.project?.prjId ?? null,
          PROJECT_ID: o.project?.id ?? null,
          DUE_DATE: o.dueDate ?? null,
          CASE_TOTAL: p?.total ?? 0,
          CASE_DONE: p?.done ?? 0,
          PROGRESS: denominator ? Math.min(100, Math.round(((p?.done ?? 0) / denominator) * 100)) : 0,
          REMARK: o.remark ?? null,
          CREATED_AT: o.createdAt
        };
      })
    });
  }

  /** 新增或更新委託單 */
  public async upsertOrder(dto: UpsertSurveyOrderDto, companyId: number): Promise<HttpResult> {
    const payload = {
      company: { id: companyId },
      title: dto.TITLE,
      requester: dto.REQUESTER,
      surveyor: dto.SURVEYOR_ID ? { id: dto.SURVEYOR_ID } : undefined,
      project: dto.PROJECT_ID ? { id: dto.PROJECT_ID } : undefined,
      dueDate: dto.DUE_DATE,
      state: (dto.STATE ?? 'DRAFT') as SurveyOrderState,
      remark: dto.REMARK
    };

    if (dto.ID) {
      const result = await this.orderRepo.update({ id: dto.ID, company: { id: companyId } }, payload);
      if (!result.affected) throw new NotFoundException(`找不到委託單：${dto.ID}`);

      return HttpResponse.success({ message: '委託單已更新', data: { ID: dto.ID } });
    }

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.orderRepo
      .createQueryBuilder('o')
      .where('o.company_id = :companyId', { companyId })
      .andWhere('o.order_no LIKE :prefix', { prefix: `SV-${day}-%` })
      .getCount();

    const saved = await this.orderRepo.save(
      this.orderRepo.create({ ...payload, orderNo: `SV-${day}-${String(count + 1).padStart(3, '0')}` })
    );
    return HttpResponse.success({ message: '委託單已建立', data: { ID: saved.id, ORDER_NO: saved.orderNo } });
  }

  // ─── 調查案件 ──────────────────────────────────────────────────

  /** 調查點清單 */
  public async listCases(dto: SurveyCaseQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.order', 'o')
      .leftJoinAndSelect('c.segment', 's')
      .leftJoinAndSelect('c.surveyor', 'u')
      .where('c.company_id = :companyId', { companyId })
      .orderBy('c.id', 'DESC')
      .take(500);

    // 一般清單看不到已刪除的：那是「已刪除案件表」與專家系統才有的視角
    qb.andWhere('c.deleted_at IS NULL');

    if (dto.ORDER_ID) qb.andWhere('c.order_id = :orderId', { orderId: dto.ORDER_ID });
    if (dto.STATE?.length) qb.andWhere('c.state IN (:...state)', { state: dto.STATE });
    if (dto.METHOD?.length) qb.andWhere('c.method IN (:...method)', { method: dto.METHOD });
    if (dto.ROAD_NAME) qb.andWhere('c.road_name ILIKE :road', { road: `%${dto.ROAD_NAME}%` });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((c) => ({
        ID: c.id,
        ORDER_NO: c.order?.orderNo ?? null,
        ORDER_ID: c.order?.id ?? null,
        ROAD_NAME: c.roadName ?? null,
        METHOD: c.method,
        STATE: c.state,
        THICKNESS_CM: c.thicknessCm ? Number(c.thicknessCm) : null,
        PCI: c.pci ? Number(c.pci) : null,
        IRI: c.iri ? Number(c.iri) : null,
        SEGMENT: c.segment?.code ?? null,
        SEGMENT_ID: c.segment?.id ?? null,
        SURVEYOR: c.surveyor?.name ?? null,
        SURVEYED_AT: c.surveyedAt ?? null,
        FINDING: c.finding ?? null,
        LNG: c.geom?.coordinates?.[0] ?? null,
        LAT: c.geom?.coordinates?.[1] ?? null,
        PHOTO_KEY: c.photoKey ?? null
      }))
    });
  }

  /**
   * 新增或更新調查點。
   *
   * 調查完成且有 PCI 時，會一併回寫到對應路段 ——
   * 實地量測的可信度高於用案件密度推算的分數，這是評估資料的最終依據。
   * 兩者要嘛一起更新、要嘛都不更新，所以包在交易裡。
   */
  public async upsertCase(dto: UpsertSurveyCaseDto, companyId: number, operatorId: number): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({ where: { id: dto.ORDER_ID, company: { id: companyId } } });
    if (!order) throw new NotFoundException(`找不到委託單：${dto.ORDER_ID}`);

    const done = dto.STATE === 'DONE';

    const payload = {
      company: { id: companyId },
      order: { id: dto.ORDER_ID },
      segment: dto.SEGMENT_ID ? { id: dto.SEGMENT_ID } : undefined,
      geom: { type: 'Point' as const, coordinates: [dto.LNG, dto.LAT] as [number, number] },
      roadName: dto.ROAD_NAME,
      method: dto.METHOD as SurveyMethod,
      state: (dto.STATE ?? 'PENDING') as SurveyCaseState,
      thicknessCm: dto.THICKNESS_CM !== undefined ? String(dto.THICKNESS_CM) : undefined,
      pci: dto.PCI !== undefined ? String(dto.PCI) : undefined,
      iri: dto.IRI !== undefined ? String(dto.IRI) : undefined,
      photoKey: dto.PHOTO_KEY,
      finding: dto.FINDING,
      surveyor: done ? { id: operatorId } : undefined,
      surveyedAt: done ? new Date() : undefined
    };

    const id = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurveyCase);

      const caseId = dto.ID
        ? (await repo.update({ id: dto.ID, company: { id: companyId } }, payload)).affected
          ? dto.ID
          : (() => {
              throw new NotFoundException(`找不到調查點：${dto.ID}`);
            })()
        : (await repo.save(repo.create(payload))).id;

      // 實測分數回寫路段：等級一律重新推導，不讓兩個欄位各說各話
      if (done && dto.PCI !== undefined && dto.SEGMENT_ID) {
        await manager.getRepository(RoadSegment).update(
          { id: dto.SEGMENT_ID, company: { id: companyId } },
          {
            pci: String(dto.PCI),
            iri: dto.IRI !== undefined ? String(dto.IRI) : undefined,
            maintainLevel: pciToLevel(dto.PCI),
            lastEvalAt: new Date()
          }
        );
      }

      return caseId;
    });

    return HttpResponse.success({ message: dto.ID ? '調查點已更新' : '調查點已建立', data: { ID: id } });
  }
  // ═══ 委託明細 ═══════════════════════════════════════════════════

  /** 明細清單；一併帶出每一項已完成的取樣數 */
  public async listDetails(orderId: number, companyId: number): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, company: { id: companyId } } });
    if (!order) throw new NotFoundException(`找不到委託單：${orderId}`);

    const rows = await this.detailRepo.find({ where: { order: { id: orderId } }, order: { seq: 'ASC' } });
    if (!rows.length) return HttpResponse.warn({ data: [], message: '這張委託單還沒有明細' });

    // 完成數一次查完：逐項查就是 N+1，而一張委託單常有十幾項
    const done = await this.caseRepo
      .createQueryBuilder('c')
      .select('c.detail_id', 'detailId')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect("COUNT(*) FILTER (WHERE c.state = 'DONE')::int", 'done')
      .where('c.detail_id IN (:...ids)', { ids: rows.map((r) => r.id) })
      .andWhere('c.deleted_at IS NULL')
      .groupBy('c.detail_id')
      .getRawMany<{ detailId: number; total: number; done: number }>();

    const byDetail = new Map(done.map((d) => [Number(d.detailId), d]));

    return HttpResponse.success({
      data: rows.map((d) => {
        const p = byDetail.get(d.id);

        return {
          ID: d.id,
          SEQ: d.seq,
          ROAD: d.road,
          ROAD_START: d.roadStart ?? null,
          ROAD_END: d.roadEnd ?? null,
          STATION: this.formatStation(d.stationK, d.stationM),
          STATION_K: d.stationK ?? null,
          STATION_M: d.stationM ?? null,
          DIRECTION: d.direction,
          LANE_COUNT: d.laneCount,
          SAMPLE_COUNT: d.sampleCount,
          ROAD_LENGTH_M: d.roadLengthM ? Number(d.roadLengthM) : null,
          ROAD_WIDTH_M: d.roadWidthM ? Number(d.roadWidthM) : null,
          CASE_TOTAL: p?.total ?? 0,
          CASE_DONE: p?.done ?? 0,
          PROGRESS: d.sampleCount ? Math.min(100, Math.round(((p?.done ?? 0) / d.sampleCount) * 100)) : 0,
          REMARK: d.remark ?? null
        };
      })
    });
  }

  /** 明細序號接在最後：業主給的清單是有順序的，插號會讓報表對不上 */
  private async nextDetailSeq(orderId: number): Promise<number> {
    const row = await this.detailRepo
      .createQueryBuilder('d')
      .select('COALESCE(MAX(d.seq), 0)', 'max')
      .where('d.order_id = :id', { id: orderId })
      .getRawOne<{ max: string }>();

    return Number(row?.max ?? 0) + 1;
  }

  /** 樁號顯示成 `3K+250`：報表與現場口語都用這個寫法 */
  private formatStation(k?: number | null, m?: number | null): string | null {
    if (k === null || k === undefined) return null;
    return `${k}K+${String(m ?? 0).padStart(3, '0')}`;
  }

  /** 新增或更新明細；序號省略時接在最後 */
  public async upsertDetail(dto: UpsertSurveyDetailDto, companyId: number): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({ where: { id: dto.ORDER_ID, company: { id: companyId } } });
    if (!order) throw new NotFoundException(`找不到委託單：${dto.ORDER_ID}`);

    const seq = dto.SEQ ?? (dto.ID ? undefined : await this.nextDetailSeq(dto.ORDER_ID));

    const payload = {
      order: { id: dto.ORDER_ID },
      ...(seq !== undefined ? { seq: Number(seq) } : {}),
      road: dto.ROAD,
      roadStart: dto.ROAD_START,
      roadEnd: dto.ROAD_END,
      stationK: dto.STATION_K,
      stationM: dto.STATION_M,
      direction: (dto.DIRECTION ?? 'BOTH') as SurveyDirection,
      laneCount: dto.LANE_COUNT ?? 2,
      sampleCount: dto.SAMPLE_COUNT ?? 1,
      roadLengthM: dto.ROAD_LENGTH_M !== undefined ? String(dto.ROAD_LENGTH_M) : undefined,
      roadWidthM: dto.ROAD_WIDTH_M !== undefined ? String(dto.ROAD_WIDTH_M) : undefined,
      remark: dto.REMARK
    };

    if (dto.ID) {
      const result = await this.detailRepo.update({ id: dto.ID, order: { id: dto.ORDER_ID } }, payload);
      if (!result.affected) throw new NotFoundException(`找不到明細：${dto.ID}`);

      return HttpResponse.success({ message: '明細已更新', data: { ID: dto.ID } });
    }

    const duplicate = await this.detailRepo.exists({ where: { order: { id: dto.ORDER_ID }, seq: Number(seq) } });
    if (duplicate) throw new ConflictException(`明細序號已存在：${seq}`);

    const saved = await this.detailRepo.save(this.detailRepo.create(payload));
    return HttpResponse.success({ message: '明細已建立', data: { ID: saved.id, SEQ: saved.seq } });
  }

  // ═══ App 現場收案 ═══════════════════════════════════════════════

  /**
   * App 上傳調查點。
   *
   * 與網頁排點的差別在「誰知道什麼」：現場人員知道實際位置、車道、天氣與破壞狀況，
   * 卻不一定知道這個點屬於委託單的第幾項 —— 所以明細是選填的，
   * 沒帶就依路名比對，比不到就當成臨時加測(`detail` 留空)。
   *
   * 去重靠 `external_id` 的唯一索引：現場網路不穩，App 會重送。
   */
  public async appIntake(dto: AppSurveyCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const existing = await this.caseRepo.findOne({
      where: { externalId: dto.EXTERNAL_ID },
      select: { id: true, caseNum: true }
    });
    if (existing) {
      this.logger.warn(`重複的鋪面案件，已略過寫入: ${dto.EXTERNAL_ID}`);
      return HttpResponse.success({
        message: '案件已存在(重複遞送)',
        data: { ID: existing.id, CASE_NUM: existing.caseNum, DUPLICATED: true }
      });
    }

    const order = await this.orderRepo.findOne({
      where: { id: dto.ORDER_ID, company: { id: user.companyId } },
      relations: { project: true }
    });
    if (!order) throw new NotFoundException(`找不到委託單：${dto.ORDER_ID}`);

    const detail = await this.resolveDetail(dto);

    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurveyCase);

      // 進來就編號：沒有編號的案件在報表與公文上對不到。
      // 格式與派工單、巡查單一致(前綴 + YYMM + 四位流水)，
      // 日期分段用「現在」而不是委託單號裡的日期 —— 後者的格式一旦改過，
      // 這裡就會安靜地把號碼編到別的月份去
      const caseNum = await this.caseEncodeService.next(
        { prefix: `${order.project?.prjId ?? 'DEMO'}SV`, seqDate: CaseEncodeService.monthOf(), pad: 4 },
        manager
      );

      return await repo.save(
        repo.create({
          company: { id: user.companyId },
          order: { id: order.id },
          detail: detail ? { id: detail.id } : null,
          caseNum,
          externalId: dto.EXTERNAL_ID,
          source: 'APP',
          geom: { type: 'Point', coordinates: [dto.LNG, dto.LAT] },
          roadName: dto.ROAD_NAME ?? detail?.road,
          method: dto.METHOD as SurveyMethod,
          state: 'DONE',
          county: dto.COUNTY,
          district: dto.DISTRICT,
          lane: dto.LANE,
          stationK: dto.STATION_K ?? detail?.stationK,
          stationM: dto.STATION_M ?? detail?.stationM,
          weather: dto.WEATHER,
          dtype: dto.DTYPE,
          degree: dto.DEGREE,
          dtypeLength: dto.DTYPE_LENGTH,
          dtypeWidth: dto.DTYPE_WIDTH,
          // 面積由長寬算出來而不是讓 App 傳：兩邊各算一次一定會有對不上的資料
          dtypeArea:
            dto.DTYPE_LENGTH !== undefined && dto.DTYPE_WIDTH !== undefined
              ? Number((dto.DTYPE_LENGTH * dto.DTYPE_WIDTH).toFixed(3))
              : undefined,
          dtypeQty: dto.DTYPE_QTY,
          thicknessCm: dto.THICKNESS_CM !== undefined ? String(dto.THICKNESS_CM) : undefined,
          pci: dto.PCI !== undefined ? String(dto.PCI) : undefined,
          iri: dto.IRI !== undefined ? String(dto.IRI) : undefined,
          photoKey: dto.PHOTO_KEY,
          finding: dto.FINDING,
          surveyor: userRef(user.uid) as never,
          surveyedAt: new Date()
        })
      );
    });

    await this.caseHistoryService.record({
      caseType: 'SURVEY',
      caseId: saved.id,
      action: 'CREATED',
      snapshot: {
        caseNum: saved.caseNum ?? null,
        orderId: order.id,
        method: saved.method,
        roadName: saved.roadName ?? null,
        pci: saved.pci ?? null,
        state: saved.state
      },
      operatorId: user.uid,
      source: 'DEVICE',
      note: user.uid ? undefined : `由 ${user.account} 上傳`,
      clientIp
    });

    return HttpResponse.success({
      message: '鋪面案件已建立',
      data: { ID: saved.id, CASE_NUM: saved.caseNum, DETAIL_ID: detail?.id ?? null, DUPLICATED: false }
    });
  }

  /** 指定了就用指定的；沒指定就依路名比對同一張委託單的明細 */
  private async resolveDetail(dto: AppSurveyCaseDto): Promise<SurveyOrderDetail | null> {
    if (dto.DETAIL_ID) {
      const found = await this.detailRepo.findOne({ where: { id: dto.DETAIL_ID, order: { id: dto.ORDER_ID } } });
      if (!found) throw new NotFoundException(`找不到明細：${dto.DETAIL_ID}`);
      return found;
    }

    if (!dto.ROAD_NAME) return null;

    return await this.detailRepo
      .createQueryBuilder('d')
      .where('d.order_id = :orderId', { orderId: dto.ORDER_ID })
      .andWhere('d.road = :road', { road: dto.ROAD_NAME })
      .orderBy('d.seq', 'ASC')
      .getOne();
  }

  // ═══ 批次狀態與轉讓 ═════════════════════════════════════════════

  /**
   * 批次更新狀態。
   *
   * `DELETED` 是軟刪除：業主會要一張「已刪除案件表」，
   * 硬刪除之後那張報表永遠是空的，而「為什麼這個樣點不見了」在驗收時一定會被問。
   *
   * 已經結案的委託單底下不可再改：結案代表報告已經送出去了。
   */
  public async batchStatus(dto: SurveyCaseStatusDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const ids = [...new Set(dto.IDS)];
    if (!ids.length) throw new BadRequestException('未指定調查點');

    const result = await this.dataSource.transaction(async (manager) => {
      const rows = await manager
        .getRepository(SurveyCase)
        .createQueryBuilder('c')
        .innerJoin('c.order', 'o')
        .select('c.id', 'id')
        .addSelect('COALESCE(c.case_num, CONCAT(\'#\', c.id))', 'caseNum')
        .addSelect('c.state', 'state')
        .addSelect('c.deleted_at', 'deletedAt')
        .addSelect('o.state', 'orderState')
        .where('c.id IN (:...ids)', { ids })
        .andWhere('c.company_id = :companyId', { companyId: user.companyId })
        .getRawMany<{ id: number; caseNum: string; state: string; deletedAt: Date | null; orderState: string }>();

      const done: string[] = [];
      const skipped: { caseNum: string; message: string }[] = [];
      const targets: number[] = [];

      for (const id of ids.filter((i) => !rows.some((r) => Number(r.id) === i))) {
        skipped.push({ caseNum: `#${id}`, message: '找不到或不屬於本單位' });
      }

      for (const row of rows) {
        if (row.orderState === 'CLOSED') {
          skipped.push({ caseNum: row.caseNum, message: '委託單已結案，報告已送出' });
          continue;
        }
        if (row.deletedAt && dto.STATE === 'DELETED') {
          skipped.push({ caseNum: row.caseNum, message: '已經是刪除狀態' });
          continue;
        }

        targets.push(Number(row.id));
        done.push(row.caseNum);
      }

      if (targets.length) {
        const patch =
          dto.STATE === 'DELETED'
            ? { deletedAt: new Date(), deletedBy: userRef(user.uid) ?? null }
            : { state: dto.STATE as SurveyCaseState, deletedAt: null, deletedBy: null };

        await manager.getRepository(SurveyCase).update(targets, patch as never);

        await this.caseHistoryService.recordMany(
          targets.map((id) => ({
            caseType: 'SURVEY' as const,
            caseId: id,
            action: (dto.STATE === 'DELETED' ? 'DELETED' : 'STATUS_CHANGED') as never,
            snapshot: { state: dto.STATE },
            toState: dto.STATE,
            operatorId: user.uid,
            note: dto.REASON,
            clientIp
          }))
        );
      }

      return { done, skipped };
    });

    const verb = dto.STATE === 'DELETED' ? '刪除' : '更新';
    const message = this.composeBatchMessage(result, verb);

    return HttpResponse.successOrWarn({
      data: { DONE: result.done, SKIPPED: result.skipped },
      okMsg: message,
      warnMsg: message,
      isEmpty: () => result.skipped.length > 0
    });
  }

  /**
   * 轉讓案件到另一張委託單(專家系統)。
   *
   * 現場常發生「這個點其實屬於另一張委託單」—— 刪掉重建會失去現場照片與量測值，
   * 所以是搬移而不是重來。轉讓一律留歷程：驗收時要說得出這個點原本屬於誰。
   */
  public async transfer(dto: TransferSurveyCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const ids = [...new Set(dto.IDS)];
    if (!ids.length) throw new BadRequestException('未指定調查點');

    const target = await this.orderRepo.findOne({ where: { id: dto.TO_ORDER_ID, company: { id: user.companyId } } });
    if (!target) throw new NotFoundException(`找不到目標委託單：${dto.TO_ORDER_ID}`);
    if (target.state === 'CLOSED') throw new BadRequestException('目標委託單已結案，不可再轉入');

    if (dto.TO_DETAIL_ID) {
      const ok = await this.detailRepo.exists({ where: { id: dto.TO_DETAIL_ID, order: { id: dto.TO_ORDER_ID } } });
      if (!ok) throw new NotFoundException(`目標明細不屬於該委託單：${dto.TO_DETAIL_ID}`);
    }

    const rows = await this.caseRepo.find({
      where: ids.map((id) => ({ id, company: { id: user.companyId } })),
      relations: { order: true }
    });

    const movable = rows.filter((r) => r.order.id !== dto.TO_ORDER_ID);
    if (!movable.length) throw new BadRequestException('沒有需要轉讓的案件(可能已經在目標委託單底下)');

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(SurveyCase).update(
        movable.map((m) => m.id),
        { order: { id: dto.TO_ORDER_ID }, detail: dto.TO_DETAIL_ID ? { id: dto.TO_DETAIL_ID } : null } as never
      );

      await this.caseHistoryService.recordMany(
        movable.map((m) => ({
          caseType: 'SURVEY' as const,
          caseId: m.id,
          action: 'UPDATED' as const,
          snapshot: { orderId: dto.TO_ORDER_ID, detailId: dto.TO_DETAIL_ID ?? null },
          before: { orderId: m.order.id, detailId: m.detail?.id ?? null },
          operatorId: user.uid,
          note: `轉讓自 ${m.order.orderNo}：${dto.REASON}`,
          clientIp
        }))
      );
    });

    return HttpResponse.success({
      message: `已轉讓 ${movable.length} 筆到 ${target.orderNo}`,
      data: { MOVED: movable.map((m) => m.caseNum ?? `#${m.id}`), TO_ORDER_NO: target.orderNo }
    });
  }

  /**
   * 專家系統的清單。
   *
   * 與一般清單的差別是「看得到全部」：所有現場欄位、以及已刪除的案件。
   * 專家要判斷的是「這批資料能不能用」，而被刪掉的那幾筆往往正是問題所在。
   */
  public async expertList(dto: ExpertSurveyQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.order', 'o')
      .leftJoinAndSelect('c.detail', 'd')
      .leftJoinAndSelect('c.segment', 's')
      .leftJoinAndSelect('c.surveyor', 'u')
      .leftJoinAndSelect('c.deletedBy', 'du')
      .where('c.company_id = :companyId', { companyId })
      .orderBy('c.id', 'DESC')
      .take(500);

    if (!dto.INCLUDE_DELETED) qb.andWhere('c.deleted_at IS NULL');
    if (dto.ORDER_ID) qb.andWhere('c.order_id = :orderId', { orderId: dto.ORDER_ID });
    if (dto.DETAIL_ID) qb.andWhere('c.detail_id = :detailId', { detailId: dto.DETAIL_ID });
    if (dto.STATE?.length) qb.andWhere('c.state IN (:...state)', { state: dto.STATE });
    if (dto.METHOD?.length) qb.andWhere('c.method IN (:...method)', { method: dto.METHOD });
    if (dto.SOURCE?.length) qb.andWhere('c.source IN (:...source)', { source: dto.SOURCE });
    if (dto.ROAD_NAME) qb.andWhere('c.road_name ILIKE :road', { road: `%${dto.ROAD_NAME}%` });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: await Promise.all(
        rows.map(async (c) => ({
          ID: c.id,
          CASE_NUM: c.caseNum ?? null,
          EXTERNAL_ID: c.externalId ?? null,
          ORDER_NO: c.order?.orderNo ?? null,
          ORDER_ID: c.order?.id ?? null,
          DETAIL_SEQ: c.detail?.seq ?? null,
          DETAIL_ID: c.detail?.id ?? null,
          SOURCE: c.source,
          STATE: c.state,
          METHOD: c.method,
          COUNTY: c.county ?? null,
          DISTRICT: c.district ?? null,
          ROAD_NAME: c.roadName ?? null,
          LANE: c.lane ?? null,
          STATION: this.formatStation(c.stationK, c.stationM),
          WEATHER: c.weather ?? null,
          DTYPE: c.dtype ?? null,
          DEGREE: c.degree ?? null,
          DTYPE_LENGTH: c.dtypeLength ?? null,
          DTYPE_WIDTH: c.dtypeWidth ?? null,
          DTYPE_AREA: c.dtypeArea ?? null,
          DTYPE_QTY: c.dtypeQty ?? null,
          THICKNESS_CM: c.thicknessCm ? Number(c.thicknessCm) : null,
          PCI: c.pci ? Number(c.pci) : null,
          IRI: c.iri ? Number(c.iri) : null,
          SEGMENT: c.segment?.code ?? null,
          SURVEYOR: c.surveyor?.name ?? null,
          SURVEYED_AT: c.surveyedAt ?? null,
          FINDING: c.finding ?? null,
          LNG: c.geom?.coordinates?.[0] ?? null,
          LAT: c.geom?.coordinates?.[1] ?? null,
          PHOTO_URL: c.photoKey ? await this.storageService.signGetUrl(c.photoKey, 600) : null,
          DELETED_AT: c.deletedAt ?? null,
          DELETED_BY: c.deletedBy?.name ?? null
        }))
      )
    });
  }

  private composeBatchMessage(result: { done: string[]; skipped: { caseNum: string; message: string }[] }, verb: string): string {
    const MAX_LISTED = 5;
    const { done, skipped } = result;

    if (!skipped.length) return `已${verb} ${done.length} 筆：${done.join('、')}`;

    const lines = skipped.slice(0, MAX_LISTED).map((s) => `・${s.caseNum} ${s.message}`);
    if (skipped.length > MAX_LISTED) lines.push(`…另有 ${skipped.length - MAX_LISTED} 筆`);

    const head = done.length ? `已${verb} ${done.length} 筆：${done.join('、')}` : `沒有調查點被${verb}`;

    return [head, `${skipped.length} 筆未${verb}`, ...lines].join('\n');
  }

}
