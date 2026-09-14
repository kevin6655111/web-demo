import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import type { Job } from 'bullmq';
import { ReportJob } from '@/report/entities/report-job.entity';
import { ReportBuilderService } from '@/report/report-builder.service';
import { StorageService } from '@/storage/storage.service';
import { QUEUE, EVENT, CLIENT_EVENT_BUS, type ReportJobPayload } from './queue.const';

/**
 * 報表工人，跑在獨立的 report-worker 行程。
 *
 * 與案件佇列分開的理由：一份報表可能跑好幾分鐘，
 * 混在同一個佇列裡會讓後面等著補路名的案件一起卡住。
 * 佇列的併發數也不同 —— 報表吃記憶體，只開 2。
 */
@Processor(QUEUE.REPORT, { concurrency: 2 })
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger('ReportWorker');

  constructor(
    @InjectRepository(ReportJob) private readonly reportRepo: Repository<ReportJob>,
    private readonly reportBuilderService: ReportBuilderService,
    private readonly storageService: StorageService,
    @Inject(CLIENT_EVENT_BUS) private readonly eventBus: ClientProxy
  ) {
    super();
  }

  async process(job: Job<ReportJobPayload>): Promise<{ rowCount: number }> {
    const { reportId, companyId, kind, format, params } = job.data;

    const record = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!record) {
      this.logger.warn(`報表工作已不存在，略過: ${reportId}`);
      return { rowCount: 0 };
    }

    // 重試時如果上一輪已經產完，就不要再產一次
    if (record.state === 'DONE' && record.fileKey) return { rowCount: record.rowCount };

    await this.reportRepo.update({ id: reportId }, { state: 'RUNNING', error: null as unknown as undefined });

    try {
      const built = await this.reportBuilderService.build(kind, format, companyId, params);
      const fileKey = await this.storageService.putReport(reportId, format, built.buffer);

      await this.reportRepo.update({ id: reportId }, { state: 'DONE', fileKey, rowCount: built.rowCount });
      this.eventBus.emit(EVENT.REPORT_DONE, { companyId, reportId, kind, format, state: 'DONE', rowCount: built.rowCount });

      return { rowCount: built.rowCount };
    } catch (error: any) {
      // 失敗要寫回資料庫：使用者在畫面上看得到「失敗」比一直轉圈好
      await this.reportRepo.update({ id: reportId }, { state: 'FAILED', error: String(error?.message ?? error) });
      this.eventBus.emit(EVENT.REPORT_DONE, { companyId, reportId, kind, format, state: 'FAILED', rowCount: 0 });
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ReportJobPayload>): void {
    this.logger.log(`✅ 報表 ${job.id} 完成`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ReportJobPayload>, err: Error): void {
    this.logger.error(`❌ 報表 ${job.id} 第 ${job.attemptsMade} 次失敗: ${err.message}`);
  }
}
