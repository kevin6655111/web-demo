import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule } from './env/env.module';
import { UtilModule } from './util/util.module';
import { RedisModule } from './redis/redis.module';
import { DatabaseModule } from './database.module';
import { BullRootModule } from './queue/bull-root.module';
import { GeoModule } from './geo/geo.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { CaseHistoryModule } from './case-history/case-history.module';
import { CaseIngestProcessor } from './queue/case-ingest.processor';
import { QUEUE } from './queue/queue.const';
import { PatrolCase } from './case-patrol/entities/patrol-case.entity';
import { PatrolCaseAddress } from './case-patrol/entities/patrol-case-address.entity';

/**
 * worker-ingest 行程：只跑案件佇列。
 *
 * 與 api 拆成兩個容器的理由是「壞的方式不同」——
 * 影像處理吃記憶體、逆地理編碼會逾時，這些都不該讓使用者的查詢一起變慢；
 * 要加吞吐時也只需要把這一種容器擴出去。
 */
@Module({
  imports: [
    EnvModule,
    UtilModule,
    RedisModule,
    DatabaseModule,
    BullRootModule,
    GeoModule,
    StorageModule,
    QueueModule,
    CaseHistoryModule,
    BullModule.registerQueue({ name: QUEUE.CASE_INGEST }),
    TypeOrmModule.forFeature([PatrolCase, PatrolCaseAddress])
  ],
  providers: [CaseIngestProcessor]
})
export class WorkerModule {}
