import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { SurveyOrder, type SurveyOrderState } from './entities/survey-order.entity';
import { SurveyCase, type SurveyCaseState, type SurveyMethod } from './entities/survey-case.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { pciToLevel } from '@/road-eval/road-eval.service';
import { SurveyCaseQueryDto, SurveyOrderQueryDto, UpsertSurveyCaseDto, UpsertSurveyOrderDto } from './survey.dto';

@Injectable()
export class SurveyService {
  private readonly logger = new Logger('Survey');

  constructor(
    @InjectRepository(SurveyOrder) private readonly orderRepo: Repository<SurveyOrder>,
    @InjectRepository(SurveyCase) private readonly caseRepo: Repository<SurveyCase>,
    @InjectRepository(RoadSegment) private readonly segmentRepo: Repository<RoadSegment>,
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
      .groupBy('c.order_id')
      .getRawMany<{ orderId: number; total: number; done: number }>();

    const byOrder = new Map(progress.map((p) => [Number(p.orderId), p]));

    return HttpResponse.success({
      data: orders.map((o) => {
        const p = byOrder.get(o.id);

        return {
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
          PROGRESS: p?.total ? Math.round((p.done / p.total) * 100) : 0,
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

    const saved = await this.orderRepo.save(this.orderRepo.create({ ...payload, orderNo: `SV-${day}-${String(count + 1).padStart(3, '0')}` }));
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
        ? ((await repo.update({ id: dto.ID, company: { id: companyId } }, payload)).affected
            ? dto.ID
            : (() => {
                throw new NotFoundException(`找不到調查點：${dto.ID}`);
              })())
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
}
