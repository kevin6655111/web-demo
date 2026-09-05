import { createHash } from 'crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { ReportJob, type ReportFormat } from './entities/report-job.entity';
import { ReportProducer } from '@/queue/report.producer';
import { StorageService } from '@/storage/storage.service';
import type { AuthUser } from '@app-types/user-auth.type';
import { CreateReportDto } from './report.dto';

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

  /** 建立報表工作(同條件重複請求會回同一筆) */
  public async createReport(dto: CreateReportDto, user: AuthUser): Promise<HttpResult> {
    const params = { STATUS: dto.STATUS ?? null, DATE_FROM: dto.DATE_FROM ?? null, DATE_TO: dto.DATE_TO ?? null };
    const dedupKey = this.makeDedupKey(user.companyId, dto.FORMAT, params);

    // 冪等：同樣條件、還沒失敗的工作直接沿用
    const existing = await this.reportRepo.findOne({ where: { dedupKey } });
    if (existing && existing.state !== 'FAILED') {
      return HttpResponse.success({
        message: existing.state === 'DONE' ? '報表已產生' : '報表產製中',
        data: { ID: existing.id, STATE: existing.state, REUSED: true }
      });
    }

    const job: ReportJob = existing
      ? await this.reportRepo.save(Object.assign(existing, { state: 'PENDING' as const, error: undefined, fileKey: undefined }))
      : await this.reportRepo.save(
          this.reportRepo.create({
            company: { id: user.companyId },
            requester: { id: user.uid },
            dedupKey,
            format: dto.FORMAT as ReportFormat,
            state: 'PENDING',
            params
          })
        );

    await this.reportProducer.dispatch({ reportId: job.id, companyId: user.companyId, format: job.format, params });

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
  public async listReports(companyId: number): Promise<HttpResult> {
    const rows = await this.reportRepo.find({ where: { company: { id: companyId } }, order: { id: 'DESC' }, take: 50 });

    return HttpResponse.successOrWarn({
      data: rows.map((r) => ({ ID: r.id, FORMAT: r.format, STATE: r.state, ROW_COUNT: r.rowCount, CREATED_AT: r.createdAt }))
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

  /** 去重鍵：同一組條件永遠算出同一個值 */
  private makeDedupKey(companyId: number, format: string, params: Record<string, unknown>): string {
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32);
    return `${companyId}:${format}:${hash}`;
  }
}
