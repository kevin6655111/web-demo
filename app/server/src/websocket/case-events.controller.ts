import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  EVENT,
  type CaseCreatedEvent,
  type CaseEnrichedEvent,
  type ReportDoneEvent,
  type WorkOrderChangedEvent
} from '@/queue/queue.const';
import { CaseGateway } from './case.gateway';

/**
 * 微服務事件消費端(Redis transport)。
 *
 * 事件的來源分散在各處 —— api 建案件、worker 補完路名、report-worker 產完報表 ——
 * 但推播只有這一個出口。要多一種通知方式(推播、簡訊)時，
 * 新增訂閱者即可，不必回頭改任何寫入流程。
 */
@Controller()
export class CaseEventsController {
  private readonly logger = new Logger('CaseEvents');

  constructor(private readonly caseGateway: CaseGateway) {}

  @EventPattern(EVENT.CASE_CREATED)
  handleCaseCreated(@Payload() event: CaseCreatedEvent): void {
    const sent = this.caseGateway.broadcast(event.companyId, 'case.created', event);
    this.logger.log(`📣 case.created ${event.externalId} → ${sent} 條連線`);
  }

  @EventPattern(EVENT.CASE_ENRICHED)
  handleCaseEnriched(@Payload() event: CaseEnrichedEvent): void {
    this.caseGateway.broadcast(event.companyId, 'case.enriched', event);
  }

  @EventPattern(EVENT.WORK_ORDER_CHANGED)
  handleWorkOrderChanged(@Payload() event: WorkOrderChangedEvent): void {
    this.caseGateway.broadcast(event.companyId, 'workorder.changed', event);
  }

  /**
   * 客服訊息。
   *
   * 推給整間公司訂閱 support 頻道的連線，前端再依 threadId 過濾 ——
   * 客服端要看到所有對話的新訊息，使用者端只看自己那條。
   * 在後端逐一比對「誰該收到」需要查資料庫，而這是每則訊息都會走的路徑。
   */
  @EventPattern('support.message')
  handleSupportMessage(@Payload() event: { companyId: number; threadId: number }): void {
    this.caseGateway.broadcast(event.companyId, 'support.message', event);
  }

  @EventPattern(EVENT.REPORT_DONE)
  handleReportDone(@Payload() event: ReportDoneEvent): void {
    // 報表可能跑好幾分鐘，使用者早就切到別的畫面 —— 推播是他知道報表好了的唯一方式
    this.caseGateway.broadcast(event.companyId, 'report.done', event);
  }
}
