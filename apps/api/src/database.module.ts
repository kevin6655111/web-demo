import { join } from 'path';
import { Module } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { EnvService } from '@/env/env.service';
import { Company } from '@/auth/entities/company.entity';
import { CompanyGrant } from '@/auth/entities/company-grant.entity';
import { Role } from '@/auth/entities/role.entity';
import { User } from '@/auth/entities/user.entity';
import { Department } from '@/auth/entities/department.entity';
import { PasswordHistory } from '@/auth/entities/password-history.entity';
import { UserActionOverride } from '@/auth/entities/user-action-override.entity';
import { ApiKey } from '@/auth/entities/api-key.entity';
import { Project } from '@/project/entities/project.entity';
import { CompanyProject } from '@/project/entities/company-project.entity';
import { ProjectVehicle } from '@/project/entities/project-vehicle.entity';
import { ProjectSection } from '@/project/entities/project-section.entity';
import { Section } from '@/project/entities/section.entity';
import { SectionArea } from '@/project/entities/section-area.entity';
import { Area } from '@/project/entities/area.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { CaseHistory } from '@/case-history/entities/case-history.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { WorkOrderStatus } from '@/work-order/entities/work-order-status.entity';
import { WorkOrderImage } from '@/work-order/entities/work-order-image.entity';
import { WorkOrderImprovement } from '@/work-order/entities/work-order-improvement.entity';
import { WorkOrderUser } from '@/work-order/entities/work-order-user.entity';
import { CaseSequence } from '@/case-encode/entities/case-sequence.entity';
import { MailJob } from '@/mail/entities/mail-job.entity';
import { DeviceToken } from '@/fire-base/entities/device-token.entity';
import { AddressPoint } from '@/location/entities/address-point.entity';
import { AddressGrid } from '@/location/entities/address-grid.entity';
import { Maintenance } from '@/maintenance/entities/maintenance.entity';
import { MaintenanceStatus } from '@/maintenance/entities/maintenance-status.entity';
import { MaintenanceRepair } from '@/maintenance/entities/maintenance-repair.entity';
import { MaintenanceImage } from '@/maintenance/entities/maintenance-image.entity';
import { ReportJob } from '@/report/entities/report-job.entity';
import { DailyCheck } from '@/dashboard/entities/daily-check.entity';
import { DashboardCaseStat } from '@/dashboard/entities/dashboard-case-stat.entity';
import { DashboardOrderStat } from '@/dashboard/entities/dashboard-order-stat.entity';
import { CaseMessage } from '@/websocket/entities/case-message.entity';
import { ModuleNav } from '@/orgstruct/entities/module.entity';
import { Feature } from '@/orgstruct/entities/feature.entity';
import { Vehicle } from '@/fleet/entities/vehicle.entity';
import { VehicleTrack } from '@/fleet/entities/vehicle-track.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { PatrolPlan } from '@/patrol-setting/entities/patrol-plan.entity';
import { RoadLine } from '@/road-setting/entities/road-line.entity';
import { RoadBlock } from '@/road-setting/entities/road-block.entity';
import { PatrolPoint } from '@/road-setting/entities/patrol-point.entity';
import { PatrolPointStat } from '@/road-setting/entities/patrol-point-stat.entity';
import { SurveyOrder } from '@/survey/entities/survey-order.entity';
import { SurveyCase } from '@/survey/entities/survey-case.entity';
import { SurveyOrderDetail } from '@/survey/entities/survey-order-detail.entity';
import { SupportThread } from '@/support/entities/support-thread.entity';
import { SupportMessage } from '@/support/entities/support-message.entity';
import { Announcement } from '@/core/announcement.entity';

/**
 * 全系統的實體清單。
 *
 * 集中列在這裡而不是用 autoLoadEntities：後者只認得各行程 forFeature 過的實體，
 * 於是每開一個新行程都要記得補上「關聯的另一端」，漏掉時的錯誤訊息
 * (Entity metadata for X#y was not found)還不會告訴你少了誰。
 * 全部行程共用同一份清單，就沒有這個問題。
 */
export const ALL_ENTITIES = [
  Company,
  CompanyGrant,
  Role,
  User,
  Department,
  PasswordHistory,
  UserActionOverride,
  ApiKey,
  Project,
  CompanyProject,
  ProjectVehicle,
  ProjectSection,
  Section,
  SectionArea,
  Area,
  PatrolCase,
  PatrolCaseAddress,
  PatrolCaseStatus,
  CaseHistory,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderImage,
  WorkOrderImprovement,
  WorkOrderUser,
  CaseSequence,
  MailJob,
  DeviceToken,
  AddressPoint,
  AddressGrid,
  Maintenance,
  MaintenanceStatus,
  MaintenanceRepair,
  MaintenanceImage,
  ReportJob,
  DailyCheck,
  DashboardCaseStat,
  DashboardOrderStat,
  CaseMessage,
  ModuleNav,
  Feature,
  Vehicle,
  VehicleTrack,
  RoadSegment,
  PatrolPlan,
  RoadLine,
  RoadBlock,
  PatrolPoint,
  PatrolPointStat,
  SurveyOrder,
  SurveyOrderDetail,
  SurveyCase,
  SupportThread,
  SupportMessage,
  Announcement
];

/**
 * 資料庫連線。所有行程共用同一份設定。
 *
 * synchronize 永遠是 false：schema 只能由 migration 改，
 * 否則某次啟動就可能把正式資料表改掉。
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [EnvService],
      useFactory: (envService: EnvService): TypeOrmModuleOptions => {
        const db = envService.getDatabaseEnv();

        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.pass,
          database: db.name,
          entities: ALL_ENTITIES,
          synchronize: false,
          // 只有 api 行程跑 migration：多個行程同時啟動時搶著改 schema 會互相鎖死
          migrationsRun: process.env.RUN_MIGRATIONS !== 'false',
          migrations: [join(__dirname, 'migrations/**/*{.ts,.js}')],
          logging: false,
          poolSize: 20,
          extra: {
            statement_timeout: 300000, // 單一 SQL 執行超時：5 分鐘
            lock_timeout: 300000, // 等待資料列鎖超時：5 分鐘
            idle_in_transaction_session_timeout: 300000 // 交易中閒置超時：避免未 commit 的交易佔住連線
          }
        };
      }
    })
  ]
})
export class DatabaseModule {}
