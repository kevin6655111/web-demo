import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseHistory } from './entities/case-history.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { WorkOrderStatus } from '@/work-order/entities/work-order-status.entity';
import { WorkOrderImprovement } from '@/work-order/entities/work-order-improvement.entity';
import { Project } from '@/project/entities/project.entity';
import { CaseHistoryController } from './case-history.controller';
import { CaseHistoryService } from './case-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([CaseHistory, PatrolCase, PatrolCaseAddress, PatrolCaseStatus, WorkOrder, WorkOrderStatus, WorkOrderImprovement, Project])],
  controllers: [CaseHistoryController],
  providers: [CaseHistoryService],
  exports: [CaseHistoryService]
})
export class CaseHistoryModule {}
