import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CLIENT_EVENT_BUS, EVENT, type MaintenanceChangedEvent, type WorkOrderChangedEvent } from './queue.const';

/**
 * 「發生了什麼」的廣播出口。
 *
 * 走 Redis transport 而不是佇列：這些事件沒有訂閱者也不算失敗 ——
 * 沒有人開著畫面時，派工單一樣要派得出去。用佇列送通知的話，
 * 沒人消費的通知會一直堆在 Redis 裡，直到把記憶體吃光。
 *
 * `emit` 不等回應，所以寫入路徑不會因為推播而變慢；
 * 匯流排掛掉時只記一行警告，不讓它把交易拖下水。
 */
@Injectable()
export class CaseEventPublisher {
  private readonly logger = new Logger('CaseEvent');

  constructor(@Inject(CLIENT_EVENT_BUS) private readonly eventBus: ClientProxy) {}

  /** 派工單有異動：建立、狀態變更、撤回、復原、刪除 */
  public workOrderChanged(event: WorkOrderChangedEvent): void {
    this.publish(EVENT.WORK_ORDER_CHANGED, event, `${event.orderNo} → ${event.state}`);
  }

  /** 巡查單有異動；整批一則 */
  public maintenanceChanged(event: MaintenanceChangedEvent): void {
    this.publish(EVENT.MAINTENANCE_CHANGED, event, `${event.caseNums.length} 筆 → ${event.state}`);
  }

  private publish(pattern: string, payload: object, note: string): void {
    try {
      this.eventBus.emit(pattern, payload);
    } catch (error: any) {
      this.logger.warn(`事件送出失敗(${pattern} ${note}): ${error?.message}`);
    }
  }
}
