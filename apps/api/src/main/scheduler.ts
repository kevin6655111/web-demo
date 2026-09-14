import '@/env.bootstrap';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { SchedulerModule } from './scheduler.module';
import { config } from '@/env.bootstrap';

/**
 * scheduler 進入點：只跑排程，不對外開埠。
 *
 * 只建立「一個」應用實例(微服務型態)：cron 註冊在 TaskService.onModuleInit，
 * 若再開一個 application context，同一支排程會被註冊兩次。
 * 微服務型態同時滿足兩個需求 —— 跑 cron，以及訂閱 api 送來的手動觸發事件。
 */
(async () => {
  const logger = new Logger('Scheduler');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(SchedulerModule, {
    transport: Transport.REDIS,
    options: { host: config.redis.host, port: config.redis.port }
  });

  app.enableShutdownHooks();
  await app.listen();

  logger.log('⏰ scheduler 已啟動(cron + 手動觸發事件訂閱)');
})();
