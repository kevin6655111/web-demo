import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { TaskService } from './task.service';
import type { TaskKey } from './task-definitions';

/** 排程觸發事件的名稱；api 與 scheduler 共用這一個字串 */
export const TASK_TRIGGER_EVENT = 'task.trigger';

/**
 * scheduler 行程的事件入口。
 *
 * 手動觸發的請求打在 api，但排程只跑在 scheduler ——
 * 中間靠 Redis 事件銜接，兩邊都不需要知道對方在哪台機器上。
 */
@Controller()
export class TaskEventsController {
  private readonly logger = new Logger('TaskEvents');

  constructor(private readonly taskService: TaskService) {}

  @EventPattern(TASK_TRIGGER_EVENT)
  async handleTrigger(@Payload() payload: { key: TaskKey; account?: string }): Promise<void> {
    this.logger.log(`📥 收到手動觸發: ${payload.key}${payload.account ? ` (by ${payload.account})` : ''}`);
    await this.taskService.trigger(payload.key, true);
  }
}
