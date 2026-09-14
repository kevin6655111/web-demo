import '@/env.bootstrap';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CaseWorkerModule } from './case-worker.module';

/** worker-ingest 進入點：不開 HTTP 埠，只連 Redis 與資料庫 */
(async () => {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(CaseWorkerModule);
  app.enableShutdownHooks(); // 收到 SIGTERM 時讓 BullMQ 把手上的工作做完再退出

  logger.log('🛠️  worker-ingest 已啟動，等待 case-ingest 工作');
})();
