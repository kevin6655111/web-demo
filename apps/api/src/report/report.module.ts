import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportJob } from './entities/report-job.entity';
import { StorageModule } from '@/storage/storage.module';
import { QueueModule } from '@/queue/queue.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportBuilderService } from './report-builder.service';
import { ReportRenderService } from './report-render.service';

@Module({
  // 報表的查詢是原生 SQL(見 kinds/)，不透過 repository ——
  // 十一種報表要 join 的表加起來幾乎是整個資料庫，逐一 forFeature 只是列一份清單
  imports: [TypeOrmModule.forFeature([ReportJob]), StorageModule, QueueModule],
  controllers: [ReportController],
  providers: [ReportService, ReportBuilderService, ReportRenderService],
  exports: [ReportService, ReportBuilderService, ReportRenderService]
})
export class ReportModule {}
