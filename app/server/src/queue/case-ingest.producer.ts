import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClientProxy } from '@nestjs/microservices';
import { QUEUE, EVENT, CLIENT_EVENT_BUS, type CaseIngestJob, type CaseCreatedEvent } from './queue.const';

@Injectable()
export class CaseIngestProducer {
  private readonly logger = new Logger('CaseIngest');

  constructor(
    @InjectQueue(QUEUE.CASE_INGEST) private readonly queue: Queue<CaseIngestJob>,
    @Inject(CLIENT_EVENT_BUS) private readonly eventBus: ClientProxy
  ) {}

  /**
   * 派工 + 廣播。
   *
   * 冪等第二道：jobId 綁定案件的外部編號。
   * BullMQ 對同一個 jobId 只會保留一份工作，所以就算 API 層的去重視窗過了、
   * 或事件被重送，重的活也只會做一次。
   */
  public async dispatch(job: CaseIngestJob, event: Omit<CaseCreatedEvent, keyof CaseIngestJob>): Promise<void> {
    // jobId 不能含冒號(BullMQ 內部用它切 key)，所以用連字號
    await this.queue.add(QUEUE.CASE_INGEST, job, { jobId: `case-${job.externalId}` });
    this.eventBus.emit(EVENT.CASE_CREATED, { ...job, ...event } satisfies CaseCreatedEvent);
    this.logger.log(`📦 已派工 case-${job.externalId}`);
  }
}
