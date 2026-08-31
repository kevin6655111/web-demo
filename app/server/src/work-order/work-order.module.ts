import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkOrder } from './entities/work-order.entity';
import { WorkOrderStatus } from './entities/work-order-status.entity';
import { WorkOrderImage } from './entities/work-order-image.entity';
import { WorkOrderImprovement } from './entities/work-order-improvement.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { StorageModule } from '@/storage/storage.module';
import { CaseHistoryModule } from '@/case-history/case-history.module';
import { WorkOrderController } from './work-order.controller';
import { WorkOrderService } from './work-order.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkOrder, WorkOrderStatus, WorkOrderImage, WorkOrderImprovement, PatrolCase, PatrolCaseStatus, Project]),
    CaseHistoryModule,
    StorageModule
  ],
  controllers: [WorkOrderController],
  providers: [WorkOrderService],
  exports: [WorkOrderService]
})
export class WorkOrderModule {}
