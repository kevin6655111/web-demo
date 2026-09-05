import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Maintenance } from './entities/maintenance.entity';
import { MaintenanceStatus } from './entities/maintenance-status.entity';
import { MaintenanceRepair } from './entities/maintenance-repair.entity';
import { MaintenanceImage } from './entities/maintenance-image.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { Project } from '@/project/entities/project.entity';
import { StorageModule } from '@/storage/storage.module';
import { CaseHistoryModule } from '@/case-history/case-history.module';
import { QueueModule } from '@/queue/queue.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Maintenance, MaintenanceStatus, MaintenanceRepair, MaintenanceImage, WorkOrder, Project]),
    CaseHistoryModule,
    StorageModule,
    QueueModule
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService]
})
export class MaintenanceModule {}
