import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolCase } from './entities/patrol-case.entity';
import { PatrolCaseAddress } from './entities/patrol-case-address.entity';
import { PatrolCaseStatus } from './entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { ProjectVehicle } from '@/project/entities/project-vehicle.entity';
import { GeoModule } from '@/geo/geo.module';
import { QueueModule } from '@/queue/queue.module';
import { CaseHistoryModule } from '@/case-history/case-history.module';
import { StorageModule } from '@/storage/storage.module';
import { CasePatrolController } from './case-patrol.controller';
import { CasePatrolService } from './case-patrol.service';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolCase, PatrolCaseAddress, PatrolCaseStatus, Project, ProjectVehicle]), GeoModule, QueueModule, CaseHistoryModule, StorageModule],
  controllers: [CasePatrolController],
  providers: [CasePatrolService],
  exports: [CasePatrolService]
})
export class CasePatrolModule {}
