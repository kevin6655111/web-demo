import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { DailyCheck } from './entities/daily-check.entity';
import { DashboardCaseStat } from './entities/dashboard-case-stat.entity';
import { DashboardOrderStat } from './entities/dashboard-order-stat.entity';
import { StorageModule } from '@/storage/storage.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SettlementService } from './settlement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PatrolCase, WorkOrder, DailyCheck, DashboardCaseStat, DashboardOrderStat]),
    StorageModule
  ],
  controllers: [DashboardController],
  providers: [DashboardService, SettlementService],
  exports: [DashboardService, SettlementService]
})
export class DashboardModule {}
