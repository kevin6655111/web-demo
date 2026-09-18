import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolCase } from '@entities/patrol-case.entity';
import { GisRegion } from './entities/gis-region.entity';
import { Building } from './entities/building.entity';
import { RoadMeas } from './entities/road-meas.entity';
import { LocationModule } from '@/location/location.module';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  imports: [LocationModule, TypeOrmModule.forFeature([PatrolCase, GisRegion, RoadMeas, Building])],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService]
})
export class GeoModule {}
