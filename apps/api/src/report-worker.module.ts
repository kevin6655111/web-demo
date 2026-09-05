import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule } from './env/env.module';
import { UtilModule } from './util/util.module';
import { RedisModule } from './redis/redis.module';
import { DatabaseModule } from './database.module';
import { BullRootModule } from './queue/bull-root.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { ReportProcessor } from './queue/report.processor';
import { ReportBuilderService } from './report/report-builder.service';
import { QUEUE } from './queue/queue.const';
import { ReportJob } from './report/entities/report-job.entity';
import { PatrolCase } from './case-patrol/entities/patrol-case.entity';

/**
 * report-worker 行程：只產報表。
 *
 * 與 worker-ingest 分開的理由是併發數不同：
 * 報表一份就吃掉幾百 MB，開太多會 OOM；案件處理則相反，越多越好。
 * 同一個容器裡沒辦法同時滿足這兩種需求。
 */
@Module({
  imports: [
    EnvModule,
    UtilModule,
    RedisModule,
    DatabaseModule,
    BullRootModule,
    StorageModule,
    QueueModule,
    BullModule.registerQueue({ name: QUEUE.REPORT }),
    TypeOrmModule.forFeature([ReportJob, PatrolCase])
  ],
  providers: [ReportProcessor, ReportBuilderService]
})
export class ReportWorkerModule {}
