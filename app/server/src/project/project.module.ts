import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { CompanyProject } from './entities/company-project.entity';
import { ProjectVehicle } from './entities/project-vehicle.entity';
import { ProjectSection } from './entities/project-section.entity';
import { Section } from './entities/section.entity';
import { SectionArea } from './entities/section-area.entity';
import { Area } from './entities/area.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, CompanyProject, ProjectVehicle, ProjectSection, Section, SectionArea, Area, PatrolCase])],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService]
})
export class ProjectModule {}
