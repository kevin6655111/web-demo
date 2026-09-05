import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { EnvService } from '@/env/env.service';
import { QUEUE, CLIENT_EVENT_BUS } from './queue.const';
import { CaseIngestProducer } from './case-ingest.producer';
import { ReportProducer } from './report.producer';
import { CaseEventPublisher } from './case-event.publisher';

/**
 * 非同步層：BullMQ(工作佇列) + Redis transport(事件匯流排)。
 *
 * 兩者分工不同，不要混用：
 *   佇列  —— 要重試、要保證做完的「工作」(產縮圖、逆地理編碼)
 *   事件  —— 廣播「發生了什麼」，訂閱者可有可無(推播、WebSocket 通知)
 */
@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: QUEUE.CASE_INGEST,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000
        }
      },
      {
        name: QUEUE.REPORT,
        defaultJobOptions: {
          // 報表重試次數少：失敗通常是查詢條件的問題，重試五次只是白等
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 200,
          removeOnFail: 500
        }
      }
    ),
    ClientsModule.registerAsync([
      {
        name: CLIENT_EVENT_BUS,
        inject: [EnvService],
        useFactory: (envService: EnvService) => {
          const redis = envService.getRedisConfig();
          return { transport: Transport.REDIS as const, options: { host: redis.host, port: redis.port } };
        }
      }
    ])
  ],
  providers: [CaseIngestProducer, ReportProducer, CaseEventPublisher],
  exports: [CaseIngestProducer, ReportProducer, CaseEventPublisher, BullModule, ClientsModule]
})
export class QueueModule {}
