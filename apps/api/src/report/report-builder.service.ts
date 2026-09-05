import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import ExcelJS from 'exceljs';
import { CASE_STATUS_DEF, CRACK_TYPE_DEF, DEGREE_DEF, NEED_REPAIR_DEF } from '@road-patrol/shared';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';

export type BuiltReport = { buffer: Buffer; rowCount: number };

// 標籤一律取自共用的代碼表定義：報表跟畫面若各寫一份，兩邊遲早會不一致，
// 而報表是要發文出去的那一份
const CRACK_LABEL: Record<string, string> = Object.fromEntries(CRACK_TYPE_DEF.map((c) => [c.key, c.name]));
const DEGREE_LABEL: Record<string, string> = Object.fromEntries(DEGREE_DEF.map((d) => [d.key, d.name]));
const STATUS_LABEL: Record<number, string> = Object.fromEntries(CASE_STATUS_DEF.map((s) => [s.value, s.name]));
const NEED_REPAIR_LABEL: Record<number, string> = Object.fromEntries(NEED_REPAIR_DEF.map((s) => [s.value, s.name]));

/**
 * 報表產生。
 *
 * 兩種格式服務兩種讀者：
 *   XLSX  給要再加工的人 —— 欄位齊全、可篩選、數字是數字不是字串
 *   DOCX  給要用印發文的人 —— 有標題、統計摘要、表格，格式固定
 *
 * 查詢一次、兩種格式共用同一批資料：報表最貴的部分是查詢，不是排版。
 */
@Injectable()
export class ReportBuilderService {
  private readonly logger = new Logger('ReportBuilder');

  constructor(@InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>) {}

  public async build(format: 'XLSX' | 'DOCX', companyId: number, params: Record<string, unknown>): Promise<BuiltReport> {
    const rows = await this.query(companyId, params);
    this.logger.log(`產生 ${format} 報表，共 ${rows.length} 列`);

    const buffer = format === 'XLSX' ? await this.buildXlsx(rows) : await this.buildDocx(rows, params);
    return { buffer, rowCount: rows.length };
  }

  /** 撈報表資料 */
  private async query(companyId: number, params: Record<string, unknown>) {
    const qb = this.caseRepo
      .createQueryBuilder('c')
      .leftJoin('c.reporter', 'u')
      .leftJoin('c.project', 'p')
      .leftJoin('c.address', 'ad')
      .leftJoin('c.status', 'st')
      .select([
        'c.case_num AS "caseNum"',
        'c.external_id AS "externalId"',
        'c.crack_type AS "crackType"',
        'c.degree AS "degree"',
        'COALESCE(st.status, 0) AS "status"',
        'COALESCE(st.need_repair, 0) AS "needRepair"',
        'ad.road AS "roadName"',
        'ad.district AS "district"',
        'ad.address AS "address"',
        'c.area AS "areaM2"',
        'c.length AS "length"',
        'c.width AS "width"',
        'c.dt_record AS "detectedAt"',
        'c.longitude AS "lng"',
        'c.latitude AS "lat"',
        'u.name AS "reporter"',
        'p.prj_id AS "projectCode"'
      ])
      .where('c.company_id = :companyId', { companyId })
      .orderBy('c.dt_record', 'DESC')
      // 報表也要有上限：沒有上限的匯出遲早會有人點下去然後把記憶體吃光
      .limit(50000);

    if (params.STATUS !== undefined) qb.andWhere('COALESCE(st.status, 0) = :status', { status: Number(params.STATUS) });
    if (params.NEED_REPAIR !== undefined) qb.andWhere('COALESCE(st.need_repair, 0) = :needRepair', { needRepair: Number(params.NEED_REPAIR) });
    if (params.CRACK_TYPE) qb.andWhere('c.crack_type = :crackType', { crackType: params.CRACK_TYPE });
    if (params.DISTRICT) qb.andWhere('ad.district = :district', { district: params.DISTRICT });
    if (params.DATE_FROM) qb.andWhere('c.dt_record >= :from', { from: new Date(String(params.DATE_FROM)) });
    if (params.DATE_TO) qb.andWhere('c.dt_record < :to', { to: new Date(`${params.DATE_TO}T23:59:59.999`) });

    return await qb.getRawMany<{
      caseNum: string | null;
      externalId: string;
      crackType: string;
      degree: string;
      status: number;
      needRepair: number;
      roadName: string | null;
      district: string | null;
      address: string | null;
      areaM2: string;
      length: string;
      width: string;
      detectedAt: Date;
      lng: number;
      lat: number;
      reporter: string | null;
      projectCode: string | null;
    }>();
  }

  /** Excel：一張明細、一張統計 */
  private async buildXlsx(rows: Awaited<ReturnType<typeof this.query>>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '道路巡查 Demo';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('案件明細', { views: [{ state: 'frozen', ySplit: 1 }] });

    sheet.columns = [
      { header: '案件編號', key: 'caseNum', width: 18 },
      { header: '原始編號', key: 'externalId', width: 24 },
      { header: '標案', key: 'projectCode', width: 12 },
      { header: '破壞類型', key: 'crackType', width: 12 },
      { header: '程度', key: 'degree', width: 8 },
      { header: '二篩狀態', key: 'status', width: 10 },
      { header: '修繕狀態', key: 'needRepair', width: 10 },
      { header: '行政區', key: 'district', width: 12 },
      { header: '路名', key: 'roadName', width: 18 },
      { header: '地址', key: 'address', width: 28 },
      { header: '長度(m)', key: 'length', width: 10 },
      { header: '寬度(m)', key: 'width', width: 10 },
      { header: '面積(m²)', key: 'areaM2', width: 12 },
      { header: '經度', key: 'lng', width: 12 },
      { header: '緯度', key: 'lat', width: 12 },
      { header: '發現時間', key: 'detectedAt', width: 22 },
      { header: '回報人', key: 'reporter', width: 12 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.autoFilter = { from: 'A1', to: 'Q1' };

    for (const r of rows) {
      sheet.addRow({
        caseNum: r.caseNum ?? '',
        externalId: r.externalId,
        projectCode: r.projectCode ?? '',
        crackType: CRACK_LABEL[r.crackType] ?? r.crackType,
        degree: DEGREE_LABEL[r.degree] ?? r.degree,
        status: STATUS_LABEL[Number(r.status)] ?? r.status,
        needRepair: NEED_REPAIR_LABEL[Number(r.needRepair)] ?? r.needRepair,
        district: r.district ?? '',
        roadName: r.roadName ?? '',
        address: r.address ?? '',
        // 數字欄位保持數字型別：使用者拿去做樞紐分析時才不用再轉一次
        length: Number(r.length),
        width: Number(r.width),
        areaM2: Number(r.areaM2),
        lng: Number(r.lng),
        lat: Number(r.lat),
        detectedAt: new Date(r.detectedAt),
        reporter: r.reporter ?? ''
      });
    }

    sheet.getColumn('areaM2').numFmt = '0.00';
    sheet.getColumn('lng').numFmt = '0.000000';
    sheet.getColumn('lat').numFmt = '0.000000';
    sheet.getColumn('detectedAt').numFmt = 'yyyy/mm/dd hh:mm';

    // 統計頁：按類型與狀態各一份小計
    const stats = workbook.addWorksheet('統計');
    stats.addRow(['破壞類型', '件數', '面積合計(m²)']).font = { bold: true };

    const byType = new Map<string, { count: number; area: number }>();
    for (const r of rows) {
      const key = CRACK_LABEL[r.crackType] ?? r.crackType;
      const acc = byType.get(key) ?? { count: 0, area: 0 };
      byType.set(key, { count: acc.count + 1, area: acc.area + Number(r.areaM2) });
    }
    for (const [type, v] of byType) stats.addRow([type, v.count, Number(v.area.toFixed(2))]);

    stats.addRow([]);
    stats.addRow(['狀態', '件數']).font = { bold: true };

    const byStatus = new Map<string, number>();
    for (const r of rows) {
      const key = STATUS_LABEL[Number(r.status)] ?? String(r.status);
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    for (const [status, count] of byStatus) stats.addRow([status, count]);

    stats.columns.forEach((c) => (c.width = 18));

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Word：公文格式，只放前 200 列明細(超過的請看 Excel) */
  private async buildDocx(rows: Awaited<ReturnType<typeof this.query>>, params: Record<string, unknown>): Promise<Buffer> {
    const period = [params.DATE_FROM ?? '不限', params.DATE_TO ?? '不限'].join(' ~ ');
    const repaired = rows.filter((r) => Number(r.needRepair) === -1).length;
    const totalArea = rows.reduce((sum, r) => sum + Number(r.areaM2), 0);

    const preview = rows.slice(0, 200);

    const headerCells = ['案件編號', '類型', '狀態', '路名', '面積(m²)', '發現時間'];

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headerCells.map(
            (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
          )
        }),
        ...preview.map(
          (r) =>
            new TableRow({
              children: [
                r.externalId,
                CRACK_LABEL[r.crackType] ?? r.crackType,
                NEED_REPAIR_LABEL[Number(r.needRepair)] ?? String(r.needRepair),
                r.roadName ?? '',
                Number(r.areaM2).toFixed(2),
                new Date(r.detectedAt).toLocaleString('zh-TW', { hour12: false })
              ].map((text) => new TableCell({ children: [new Paragraph(String(text))] }))
            })
        )
      ]
    });

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: '道路巡查案件彙整報告', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
            new Paragraph({ text: `統計期間：${period}`, alignment: AlignmentType.CENTER }),
            new Paragraph({ text: '' }),
            new Paragraph({ text: '一、統計摘要', heading: HeadingLevel.HEADING_2 }),
            new Paragraph(`案件總數：${rows.length} 件`),
            new Paragraph(`已完修：${repaired} 件（完修率 ${rows.length ? Math.round((repaired / rows.length) * 100) : 0}%）`),
            new Paragraph(`破壞面積合計：${totalArea.toFixed(2)} 平方公尺`),
            new Paragraph({ text: '' }),
            new Paragraph({ text: '二、案件明細', heading: HeadingLevel.HEADING_2 }),
            new Paragraph(rows.length > preview.length ? `（明細共 ${rows.length} 筆，本文件列出前 ${preview.length} 筆）` : ''),
            table,
            new Paragraph({ text: '' }),
            new Paragraph({
              text: `本報告由系統於 ${new Date().toLocaleString('zh-TW', { hour12: false })} 產生，資料為示範用途。`,
              alignment: AlignmentType.RIGHT
            })
          ]
        }
      ]
    });

    return await Packer.toBuffer(doc);
  }
}
