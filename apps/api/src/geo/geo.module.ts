import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolCase } from '@entities/patrol-case.entity';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolCase])],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService]
})
export class GeoModule {}
