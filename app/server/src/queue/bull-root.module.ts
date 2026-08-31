import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvService } from '@/env/env.service';

/** BullMQ 的 Redis 連線設定，API 與 worker 都要 import */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [EnvService],
      useFactory: (envService: EnvService) => {
        const redis = envService.getRedisConfig();

        return {
          connection: {
            host: redis.host,
            port: redis.port,
            maxRetriesPerRequest: null, // BullMQ 要求：阻塞式指令不能被中途放棄
            enableReadyCheck: false,
            retryStrategy: (times: number) => Math.min(times * 1000, 10000)
          }
        };
      }
    })
  ],
  exports: [BullModule]
})
export class BullRootModule {}
