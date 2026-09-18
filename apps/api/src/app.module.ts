import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule } from './env/env.module';
import { UtilModule } from './util/util.module';
import { RedisModule } from './redis/redis.module';
import { SecurityModule } from './security/security.module';
import { DatabaseModule } from './database.module';
import { BullRootModule } from './queue/bull-root.module';
import { HttpModule } from './http/http.module';
import { AuthModule } from './auth/auth.module';
import { GeoModule } from './geo/geo.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { CasePatrolModule } from './case-patrol/case-patrol.module';
import { CaseHistoryModule } from './case-history/case-history.module';
import { ProjectModule } from './project/project.module';
import { WorkOrderModule } from './work-order/work-order.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { CaseEncodeModule } from './case-encode/case-encode.module';
import { LocationModule } from './location/location.module';
import { MailModule } from './mail/mail.module';
import { FireBaseModule } from './fire-base/fire-base.module';
import { ReportModule } from './report/report.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WebsocketModule } from './websocket/websocket.module';
import { TaskModule } from './task/task.module';
import { OrgstructModule } from './orgstruct/orgstruct.module';
import { FleetModule } from './fleet/fleet.module';
import { RoadEvalModule } from './road-eval/road-eval.module';
import { PatrolSettingModule } from './patrol-setting/patrol-setting.module';
import { RoadSettingModule } from './road-setting/road-setting.module';
import { SurveyModule } from './survey/survey.module';
import { SupportModule } from './support/support.module';
import { SiftModule } from './sift/sift.module';
import { CoreModule } from './core/core.module';
import { IntegrationModule } from './integration/integration.module';
import { VehicleCommModule } from './vehicle-comm/vehicle-comm.module';
import { InitProcessModule } from './init-process/init-process.module';

/**
 * api 行程：對外服務。
 *
 * 這裡有 TaskController 但沒有 TaskService：查詢與觸發走 api，實際執行在 scheduler。
 * TilesModule 與各 worker 也都不在這裡 ——
 * 那些各自有自己的行程與容器(見 server/tiles.ts、scheduler.ts、worker.ts)。
 * 一個行程只做一種會壞的事，出問題時的影響範圍才是可預期的。
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    EnvModule,
    UtilModule,
    RedisModule,
    SecurityModule,
    DatabaseModule,
    BullRootModule,
    HttpModule,
    AuthModule,
    GeoModule,
    StorageModule,
    QueueModule,
    CasePatrolModule,
    CaseHistoryModule,
    ProjectModule,
    WorkOrderModule,
    MaintenanceModule,
    CaseEncodeModule,
    LocationModule,
    MailModule,
    FireBaseModule,
    ReportModule,
    DashboardModule,
    WebsocketModule,
    TaskModule,
    OrgstructModule,
    FleetModule,
    RoadEvalModule,
    PatrolSettingModule,
    RoadSettingModule,
    SurveyModule,
    SupportModule,
    SiftModule,
    CoreModule,
    IntegrationModule,
    VehicleCommModule,
    InitProcessModule
  ]
})
export class AppModule {}
