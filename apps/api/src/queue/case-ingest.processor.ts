import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { PatrolCase } from '@entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { GeoService } from '@/geo/geo.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { QUEUE, type CaseIngestJob } from './queue.const';

/**
 * case-ingest 的實際工人，跑在獨立的 worker 行程(見 server/worker.ts)。
 * API 只負責寫進資料庫與派工，慢的事情都在這裡做，尖峰時不會拖垮寫入。
 *
 * 冪等第三道：這裡的每個步驟都寫成「重跑一次結果相同」——
 * 佇列只保證 at-least-once，工作被重試是常態而非異常。
 */
@Processor(QUEUE.CASE_INGEST, { concurrency: 4 })
export class CaseIngestProcessor extends WorkerHost {
  private readonly logger = new Logger('CaseIngestWorker');

  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(PatrolCaseAddress) private readonly addressRepo: Repository<PatrolCaseAddress>,
    private readonly geoService: GeoService,
    private readonly caseHistoryService: CaseHistoryService
  ) {
    super();
  }

  async process(job: Job<CaseIngestJob>): Promise<{ roadName: string | null }> {
    const { caseId, lng, lat } = job.data;

    const current = await this.caseRepo.findOne({ where: { id: caseId }, relations: { address: true } });
    if (!current) {
      this.logger.warn(`案件已不存在，略過: ${caseId}`);
      return { roadName: null };
    }

    // 已經補過就不再算一次：佇列只保證 at-least-once，重試是常態
    if (current.address?.road) return { roadName: current.address.road };

    const before = { road: current.address?.road ?? null, address: current.address?.address ?? null };

    const roadName = await this.geoService.reverseGeocode(lng, lat);

    // 地址在獨立的表：案件建立當下沒有地址是正常狀態，不是資料不完整
    if (current.address) {
      await this.addressRepo.update(
        { id: current.address.id },
        { road: roadName, address: roadName, oAddress: roadName }
      );
    } else {
      await this.addressRepo.save(
        this.addressRepo.create({ patrolCase: { id: caseId }, road: roadName, address: roadName, oAddress: roadName })
      );
    }

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId,
      action: 'GEOCODED',
      snapshot: { road: roadName, address: roadName },
      before,
      source: 'WORKER',
      note: roadName
    });

    return { roadName };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<CaseIngestJob>): void {
    this.logger.log(`✅ ${job.id} 完成`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CaseIngestJob>, err: Error): void {
    this.logger.error(`❌ ${job.id} 第 ${job.attemptsMade} 次失敗: ${err.message}`);
  }
}
