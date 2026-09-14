import '@/env.bootstrap';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MailWorkerModule } from './mail-worker.module';

/** mail-worker 進入點：只消費郵件佇列 */
(async () => {
  const logger = new Logger('MailWorker');

  const app = await NestFactory.createApplicationContext(MailWorkerModule);
  app.enableShutdownHooks();

  logger.log('📧 mail-worker 已啟動，等待郵件工作');
})();
