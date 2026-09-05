import { Module } from '@nestjs/common';
import { QueueModule } from '@/queue/queue.module';
import { TaskController } from './task.controller';

/** api 行程用：只暴露排程的查詢與觸發，實際執行在 scheduler 行程 */
@Module({
  imports: [QueueModule],
  controllers: [TaskController]
})
export class TaskModule {}
