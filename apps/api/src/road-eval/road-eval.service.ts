import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { MAINTAIN_LEVEL, RoadSegment, type MaintainLevel } from './entities/road-segment.entity';
import { SegmentEvalDto, SegmentQueryDto, UpdateSegmentDto } from './road-eval.dto';

/**
 * PCI 對應養護等級的門檻。
 *
 * 數字取自常見的鋪面管理慣例(PCI 100 為全新)：
 * 70 以上只需例行養護、55–70 該排預防性維護、
 * 40–55 已影響行車、40 以下要整段刨鋪。
 * 寫成常數而不是散在 SQL 裡，是因為這條線會隨業主要求調整。
 */
const PCI_THRESHOLD = { GOOD: 70, FAIR: 55, POOR: 40 } as const;

export function pciToLevel(pci: number): MaintainLevel {
  if (pci >= PCI_THRESHOLD.GOOD) return 'GOOD';
  if (pci >= PCI_THRESHOLD.FAIR) return 'FAIR';
  if (pci >= PCI_THRESHOLD.POOR) return 'POOR';
  return 'CRITICAL';
}

@Injectable()
export class RoadEvalService {
  private readonly logger = new Logger('RoadEval');

  constructor(@InjectRepository(RoadSegment) private readonly segmentRepo: Repository<RoadSegment>) {}

  /** 路段清單(表格用) */
  public async list(dto: SegmentQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.buildQuery(dto, companyId).leftJoinAndSelect('s.project', 'p').orderBy('s.pci', 'ASC').take(500);
    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((s) => ({
        ID: s.id,
        CODE: s.code,
        ROAD_NAME: s.roadName,
        SECTION: s.section ?? null,
        DISTRICT: s.district ?? null,
        LENGTH_M: Number(s.lengthM),
        LANE_COUNT: s.laneCount,
        PCI: Number(s.pci),
        IRI: s.iri ? Number(s.iri) : null,
        MAINTAIN_LEVEL: s.maintainLevel,
        CASE_COUNT: s.caseCount,
        PROJECT: s.project?.prjId ?? null,
        LAST_EVAL_AT: s.lastEvalAt ?? null,
        REMARK: s.remark ?? null
      }))
    });
  }

  /**
   * 路段圖層。
   *
   * 回 GeoJSON LineString 讓地圖依養護等級著色 ——
   * 這是道路評估唯一真正有用的呈現方式：表格看不出「壞的路連成一片」。
   */
  public async getLayer(dto: SegmentQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.buildQuery(dto, companyId)
      .select('s.id', 'id')
      .addSelect('s.code', 'code')
      .addSelect('s.road_name', 'roadName')
      .addSelect('s.section', 'section')
      .addSelect('s.pci', 'pci')
      .addSelect('s.maintain_level', 'maintainLevel')
      .addSelect('s.case_count', 'caseCount')
      .addSelect('s.length_m', 'lengthM')
      .addSelect('ST_AsGeoJSON(s.geom)::json', 'geometry')
      .limit(5000);

    const rows = await qb.getRawMany<{ geometry: unknown; [k: string]: unknown }>();

    return HttpResponse.successOrWarn({
      data: {
        type: 'FeatureCollection',
        features: rows.map(({ geometry, ...properties }) => ({
          type: 'Feature',
          geometry,
          properties: { ...properties, pci: Number(properties.pci), lengthM: Number(properties.lengthM) }
        }))
      },
      isEmpty: (v) => !v?.features?.length
    });
  }

  /** 等級分布統計(給圓餅圖與 KPI) */
  public async getSummary(companyId: number): Promise<HttpResult> {
    const rows = await this.segmentRepo
      .createQueryBuilder('s')
      .select('s.maintain_level', 'LEVEL')
      .addSelect('COUNT(*)::int', 'COUNT')
      .addSelect('ROUND(SUM(s.length_m)::numeric / 1000, 2)::float8', 'LENGTH_KM')
      .addSelect('ROUND(AVG(s.pci)::numeric, 1)::float8', 'AVG_PCI')
      .where('s.company_id = :companyId', { companyId })
      .groupBy('s.maintain_level')
      .getRawMany<{ LEVEL: string; COUNT: number; LENGTH_KM: number; AVG_PCI: number }>();

    // 補齊沒有資料的等級：圓餅圖少一塊會讓人以為漏了
    const byLevel = new Map(rows.map((r) => [r.LEVEL, r]));
    const data = MAINTAIN_LEVEL.map(
      (level) => byLevel.get(level) ?? { LEVEL: level, COUNT: 0, LENGTH_KM: 0, AVG_PCI: 0 }
    );

    const total = data.reduce((sum, d) => sum + d.COUNT, 0);
    const needRepair = data
      .filter((d) => d.LEVEL === 'POOR' || d.LEVEL === 'CRITICAL')
      .reduce((sum, d) => sum + d.COUNT, 0);

    return HttpResponse.success({
      data: {
        BY_LEVEL: data,
        TOTAL: total,
        NEED_REPAIR: needRepair,
        NEED_REPAIR_RATE: total ? Math.round((needRepair / total) * 100) : 0
      }
    });
  }

  /** 人工調整路段評分 */
  public async update(dto: UpdateSegmentDto, companyId: number): Promise<HttpResult> {
    const segment = await this.segmentRepo.findOne({ where: { id: dto.ID, company: { id: companyId } } });
    if (!segment) throw new NotFoundException(`找不到路段：${dto.ID}`);

    const pci = dto.PCI ?? Number(segment.pci);

    await this.segmentRepo.update(
      { id: dto.ID },
      {
        pci: String(pci),
        iri: dto.IRI !== undefined ? String(dto.IRI) : segment.iri,
        laneCount: dto.LANE_COUNT ?? segment.laneCount,
        remark: dto.REMARK ?? segment.remark,
        // 等級一律由 PCI 推導，不讓人直接改 —— 否則兩個欄位會互相矛盾
        maintainLevel: pciToLevel(pci),
        lastEvalAt: new Date()
      }
    );

    return HttpResponse.success({ message: '路段已更新', data: { ID: dto.ID, MAINTAIN_LEVEL: pciToLevel(pci) } });
  }

  /**
   * 依案件密度重算 PCI。
   *
   * 算法刻意簡單且可解釋：每公里案件數換算成扣分，破壞面積再加權。
   * 正式系統會接鋪面檢測車的資料，但那不改變這裡的結構 ——
   * 換的是分數來源，不是「路段有分數、分數決定等級」這件事。
   */
  public async evaluate(dto: SegmentEvalDto, companyId: number): Promise<HttpResult> {
    const updated = await this.segmentRepo.query(
      `
      WITH hit AS (
        SELECT s.id,
               COUNT(c.id)::int AS case_count,
               COALESCE(SUM(c.area_m2), 0)::float8 AS area
          FROM road_segments s
          LEFT JOIN patrol_cases c
                 ON c.company_id = s.company_id
                -- 30 公尺內的案件算在這條路段上：巷弄密集處要夠窄才不會互相搶案件
                AND ST_DWithin(c.geom, s.geom, 30)
                AND c.detected_at >= now() - interval '180 days'
         WHERE s.company_id = $1
           AND ($2::int IS NULL OR s.project_id = $2)
         GROUP BY s.id
      ), scored AS (
        SELECT h.id,
               h.case_count,
               -- 每公里案件數 × 6 分，破壞面積 × 4 分，下限 5 分(不給 0，0 分沒有區別度)
               GREATEST(5, 100
                 - LEAST(60, (h.case_count / GREATEST(s.length_m / 1000, 0.05)) * 6)
                 - LEAST(25, h.area * 4)
               ) AS pci
          FROM hit h
          JOIN road_segments s ON s.id = h.id
      )
      UPDATE road_segments s
         SET case_count = sc.case_count,
             pci = ROUND(sc.pci::numeric, 2),
             maintain_level = CASE
               WHEN sc.pci >= 70 THEN 'GOOD'
               WHEN sc.pci >= 55 THEN 'FAIR'
               WHEN sc.pci >= 40 THEN 'POOR'
               ELSE 'CRITICAL'
             END,
             last_eval_at = now()
        FROM scored sc
       WHERE s.id = sc.id
      RETURNING s.id
      `,
      [companyId, dto.PROJECT_ID ?? null]
    );

    this.logger.log(`🛣️  重算 ${updated?.length ?? 0} 條路段`);
    return HttpResponse.success({ message: '評估完成', data: { UPDATED: updated?.length ?? 0 } });
  }

  private buildQuery(dto: SegmentQueryDto, companyId: number) {
    const qb = this.segmentRepo.createQueryBuilder('s').where('s.company_id = :companyId', { companyId });

    if (dto.ROAD_NAME) qb.andWhere('s.road_name ILIKE :road', { road: `%${dto.ROAD_NAME}%` });
    if (dto.DISTRICT) qb.andWhere('s.district = :district', { district: dto.DISTRICT });
    if (dto.MAINTAIN_LEVEL?.length) qb.andWhere('s.maintain_level IN (:...levels)', { levels: dto.MAINTAIN_LEVEL });
    if (dto.PCI_MIN !== undefined) qb.andWhere('s.pci >= :pciMin', { pciMin: dto.PCI_MIN });
    if (dto.PCI_MAX !== undefined) qb.andWhere('s.pci <= :pciMax', { pciMax: dto.PCI_MAX });
    if (dto.PROJECT_ID) qb.andWhere('s.project_id = :projectId', { projectId: dto.PROJECT_ID });

    // 標案以代碼比對而非內部 id：查詢面板的下拉送的是 PRJ_ID，
    // 使用者在畫面上看到與說出的也是那組代碼
    if (dto.PRJ_ID) {
      qb.andWhere('EXISTS (SELECT 1 FROM projects prj WHERE prj.id = s.project_id AND prj.prj_id = :scopePrjId)', {
        scopePrjId: dto.PRJ_ID
      });
    }

    // 工務段與轄區都掛在「標案-工務段」之下：同一個工務段在不同標案
    // 負責的行政區可以不同，所以要從標案這一端往下找
    if (dto.SECTION_ID) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM project_sections ps
                  WHERE ps.project_id = s.project_id AND ps.is_active = true AND ps.section_id = :scopeSectionId)`,
        { scopeSectionId: dto.SECTION_ID }
      );
    }

    if (dto.COUNTY) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM project_sections ps
                   JOIN section_areas sa ON sa.project_section_id = ps.id AND sa.is_active = true
                   JOIN areas ar ON ar.id = sa.area_id
                  WHERE ps.project_id = s.project_id AND ps.is_active = true AND ar.county = :scopeCounty)`,
        { scopeCounty: dto.COUNTY }
      );
    }

    return qb;
  }
}
