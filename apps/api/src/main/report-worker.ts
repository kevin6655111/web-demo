import '@/env.bootstrap';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ReportWorkerModule } from './report-worker.module';

/** report-worker 進入點：專門產 Excel / Word */
(async () => {
  const logger = new Logger('ReportWorker');

  const app = await NestFactory.createApplicationContext(ReportWorkerModule);
  app.enableShutdownHooks();

  logger.log('📊 report-worker 已啟動，等待報表工作');
})();
