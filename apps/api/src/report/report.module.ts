import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportJob } from './entities/report-job.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { StorageModule } from '@/storage/storage.module';
import { QueueModule } from '@/queue/queue.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportBuilderService } from './report-builder.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReportJob, PatrolCase]), StorageModule, QueueModule],
  controllers: [ReportController],
  providers: [ReportService, ReportBuilderService],
  exports: [ReportService, ReportBuilderService]
})
export class ReportModule {}
