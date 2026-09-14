import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { REPORT_KIND_DEF, findByKey } from '@road-patrol/shared';
import { ReportJob, type ReportFormat } from './entities/report-job.entity';
import { ReportProducer } from '@/queue/report.producer';
import { StorageService } from '@/storage/storage.service';
import type { AuthUser } from '@app-types/user-auth.type';
import { CreateReportDto, ReportQueryDto } from './report.dto';

/**
 * 參數群組 → 實際要送的鍵。
 *
 * `REPORT_KIND_DEF.params` 宣告的是**群組**，因為那份定義同時給前端
 * 決定要顯示哪些欄位 —— 「DATE」對使用者是一組起訖，對後端是兩個鍵。
 * 只有 DATE 需要展開，其餘一對一，但列在同一張表比較好讀。
 */
const PARAM_KEYS: Record<string, string[]> = {
  DATE: ['DATE_FROM', 'DATE_TO'],
  DAY: ['DAY'],
  MONTH: ['MONTH'],
  PRJ_ID: ['PRJ_ID'],
  COUNTY: ['COUNTY'],
  DISTRICT: ['DISTRICT'],
  VEHICLE_ID: ['VEHICLE_ID'],
  USER_ID: ['USER_ID'],
  ORDER_ID: ['ORDER_ID'],
  STATUS: ['STATUS'],
  NEED_REPAIR: ['NEED_REPAIR'],
  CRACK_TYPE: ['CRACK_TYPE'],
  MAINTAIN_LEVEL: ['MAINTAIN_LEVEL']
};

/**
 * 報表的請求端(跑在 api 行程)。
 *
 * 這裡只做三件事：算去重鍵、建工作、派工。
 * 真正產檔案的程式在 report-worker 行程，因為一份三萬列的 Excel
 * 會把整個 event loop 佔住好幾秒 —— 那不該發生在使用者 API 的行程裡。
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger('Report');

  constructor(
    @InjectRepository(ReportJob) private readonly reportRepo: Repository<ReportJob>,
    private readonly reportProducer: ReportProducer,
    private readonly storageService: StorageService
  ) {}

  /** 建立報表工作(同種類、同條件重複請求會回同一筆) */
  public async createReport(dto: CreateReportDto, user: AuthUser): Promise<HttpResult> {
    const kind = findByKey(REPORT_KIND_DEF as never, dto.KIND) as
      | { key: string; name: string; params: readonly string[]; required: readonly string[]; formats: readonly string[] }
      | undefined;
    if (!kind) throw new BadRequestException(`不支援的報表種類：${dto.KIND}`);

    if (!kind.formats.includes(dto.FORMAT)) {
      throw new BadRequestException(`${kind.name}不支援 ${dto.FORMAT} 格式(可用：${kind.formats.join('、')})`);
    }

    const params = this.collectParams(kind, dto);
    const dedupKey = this.makeDedupKey(user.companyId, dto.KIND, dto.FORMAT, params);

    // 冪等：同樣條件、還沒失敗的工作直接沿用
    const existing = await this.reportRepo.findOne({ where: { dedupKey } });
    if (existing && existing.state !== 'FAILED') {
      return HttpResponse.success({
        message: existing.state === 'DONE' ? '報表已產生' : '報表產製中',
        data: { ID: existing.id, STATE: existing.state, REUSED: true }
      });
    }

    const job: ReportJob = existing
      ? await this.reportRepo.save(
          Object.assign(existing, { state: 'PENDING' as const, error: undefined, fileKey: undefined })
        )
      : await this.reportRepo.save(
          this.reportRepo.create({
            company: { id: user.companyId },
            requester: { id: user.uid },
            dedupKey,
            kind: kind.key,
            title: kind.name,
            format: dto.FORMAT as ReportFormat,
            state: 'PENDING',
            params
          })
        );

    await this.reportProducer.dispatch({
      reportId: job.id,
      companyId: user.companyId,
      kind: job.kind,
      format: job.format,
      params
    });

    return HttpResponse.success({ message: '報表已排入產製', data: { ID: job.id, STATE: job.state, REUSED: false } });
  }

  /** 查詢報表狀態；完成時附上短效下載網址 */
  public async getReport(id: number, companyId: number): Promise<HttpResult> {
    const job = await this.reportRepo.findOne({ where: { id, company: { id: companyId } } });
    if (!job) throw new NotFoundException(`找不到報表：${id}`);

    const url = job.state === 'DONE' && job.fileKey ? await this.storageService.signGetUrl(job.fileKey, 300) : null;

    return HttpResponse.success({
      data: {
        ID: job.id,
        KIND: job.kind,
        TITLE: job.title ?? job.kind,
        FORMAT: job.format,
        STATE: job.state,
        ROW_COUNT: job.rowCount,
        ERROR: job.error ?? null,
        DOWNLOAD_URL: url, // 只有這一刻有效，過期就再打一次這支 API
        CREATED_AT: job.createdAt
      }
    });
  }

  /** 查詢公司的報表清單 */
  public async listReports(companyId: number, dto: ReportQueryDto = {}): Promise<HttpResult> {
    const rows = await this.reportRepo.find({
      where: { company: { id: companyId }, ...(dto.KIND ? { kind: dto.KIND } : {}) },
      relations: { requester: true },
      order: { id: 'DESC' },
      take: 50
    });

    return HttpResponse.successOrWarn({
      data: rows.map((r) => ({
        ID: r.id,
        KIND: r.kind,
        // 標題存的是產生當下的名稱：種類的中文名以後改了，舊報表仍對得上當時的叫法
        TITLE: r.title ?? findByKey(REPORT_KIND_DEF as never, r.kind)?.name ?? r.kind,
        FORMAT: r.format,
        STATE: r.state,
        ROW_COUNT: r.rowCount,
        PARAMS: r.params,
        REQUESTER: r.requester?.name ?? null,
        ERROR: r.error ?? null,
        CREATED_AT: r.createdAt
      }))
    });
  }

  /** 報表種類的選單：前端依它決定要顯示哪些參數欄位 */
  public getKinds(): HttpResult {
    return HttpResponse.success({
      data: REPORT_KIND_DEF.map((k) => ({
        KEY: k.key,
        NAME: k.name,
        GROUP: k.group,
        PARAMS: k.params,
        FORMATS: k.formats
      }))
    });
  }

  /**
   * 刪除報表工作。
   *
   * 連同物件儲存上的檔案一起刪：只刪資料庫紀錄的話，
   * 檔案會變成沒有人知道它存在的孤兒，佔著空間直到有人手動清。
   *
   * 檔案刪除失敗不阻擋紀錄刪除 —— 使用者要的是「這筆從清單上消失」，
   * 殘留的檔案由清理排程兜底。
   */
  public async deleteReport(id: number, companyId: number): Promise<HttpResult> {
    const job = await this.reportRepo.findOne({ where: { id, company: { id: companyId } } });
    if (!job) throw new NotFoundException(`找不到報表：${id}`);

    if (job.state === 'RUNNING') throw new ConflictException('報表產製中，請等完成後再刪除');

    if (job.fileKey) {
      try {
        await this.storageService.deleteObject(job.fileKey);
      } catch (error: any) {
        this.logger.warn(`報表檔案刪除失敗(${job.fileKey})：${error?.message}`);
      }
    }

    await this.reportRepo.delete({ id });

    return HttpResponse.success({ message: '報表已刪除' });
  }

  /**
   * 依種類收集參數，順便擋掉缺必填的請求。
   *
   * 鍵的順序固定(依 `PARAM_GROUP` 展開的順序)，去重鍵才算得出一致的雜湊 ——
   * 依物件字面順序序列化的話，同樣的條件換個填寫順序就會被當成兩份報表。
   */
  private collectParams(
    kind: { key: string; name: string; params: readonly string[]; required: readonly string[] },
    dto: CreateReportDto
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const source = dto as unknown as Record<string, unknown>;

    for (const group of kind.params) {
      for (const key of PARAM_KEYS[group] ?? []) {
        const value = source[key];
        params[key] = value === undefined || value === '' ? null : value;
      }
    }

    // 缺必填的參數在送出時就說清楚 —— 讓它排進佇列、跑完、回一張空表，
    // 使用者只會看到「0 列」而不知道是自己少填了一個欄位
    const missing = kind.required.filter((group) => (PARAM_KEYS[group] ?? []).every((k) => params[k] === null));
    if (missing.length) {
      throw new BadRequestException(`${kind.name}需要參數：${missing.map((g) => PARAM_KEYS[g].join(' 或 ')).join('、')}`);
    }

    return params;
  }

  /** 去重鍵：同一種類、同一組條件永遠算出同一個值 */
  private makeDedupKey(companyId: number, kind: string, format: string, params: Record<string, unknown>): string {
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32);
    return `${companyId}:${kind}:${format}:${hash}`;
  }
}
