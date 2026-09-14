import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvModule } from '@/env/env.module';
import { UtilModule } from '@/util/util.module';
import { RedisModule } from '@/redis/redis.module';
import { DatabaseModule } from '@/database.module';
import { GeoModule } from '@/geo/geo.module';
import { TilesModule } from '@/tiles/tiles.module';
import { RoadEvalModule } from '@/road-eval/road-eval.module';
import { RoadSettingModule } from '@/road-setting/road-setting.module';
import { DashboardModule } from '@/dashboard/dashboard.module';
import { CaseHistoryModule } from '@/case-history/case-history.module';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { ReportJob } from '@/report/entities/report-job.entity';
import { Company } from '@/auth/entities/company.entity';
import { TaskRunner } from '@/task/task-runner';
import { TaskService } from '@/task/task.service';
import { TaskEventsController } from '@/task/task-events.controller';

/**
 * scheduler 行程：只跑排程。
 *
 * 拆出來的理由不是效能，是「只該有一份」——
 * api 可以有很多實例，但每日備份不能被跑十次。
 * 即使如此仍然保留 Redis 鎖：滾動部署時新舊實例會短暫並存。
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    EnvModule,
    UtilModule,
    RedisModule,
    DatabaseModule,
    GeoModule,
    TilesModule,
    RoadEvalModule,
    RoadSettingModule,
    DashboardModule,
    CaseHistoryModule,
    TypeOrmModule.forFeature([PatrolCase, PatrolCaseAddress, WorkOrder, ReportJob, Company])
  ],
  controllers: [TaskEventsController],
  providers: [TaskRunner, TaskService]
})
export class SchedulerModule {}
