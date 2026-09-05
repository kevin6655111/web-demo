import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClientProxy } from '@nestjs/microservices';
import { QUEUE, CLIENT_EVENT_BUS, type ReportJobPayload } from './queue.const';

@Injectable()
export class ReportProducer {
  private readonly logger = new Logger('ReportQueue');

  constructor(
    @InjectQueue(QUEUE.REPORT) private readonly queue: Queue<ReportJobPayload>,
    @Inject(CLIENT_EVENT_BUS) private readonly eventBus: ClientProxy
  ) {}

  /**
   * 派報表工作。
   * jobId 綁在報表工作編號上：重複請求同一份報表不會排出第二份，
   * 這與 ReportService 的 dedupKey 是同一件事在兩層的表現。
   */
  public async dispatch(payload: ReportJobPayload): Promise<void> {
    await this.queue.add(QUEUE.REPORT, payload, { jobId: `report-${payload.reportId}` });
    this.logger.log(`📊 已排入報表 #${payload.reportId} (${payload.format})`);
  }

  /** 給 report-worker 用：完成後回報事件，由 api 那側推播給前端 */
  public emitDone(event: Record<string, unknown>): void {
    this.eventBus.emit('report.done', event);
  }
}
