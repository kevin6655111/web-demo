import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleNav } from './entities/module.entity';
import { Feature } from './entities/feature.entity';
import { OrgstructController } from './orgstruct.controller';
import { OrgstructService } from './orgstruct.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModuleNav, Feature])],
  controllers: [OrgstructController],
  providers: [OrgstructService],
  exports: [OrgstructService]
})
export class OrgstructModule {}
