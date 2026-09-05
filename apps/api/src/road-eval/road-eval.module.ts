import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoadSegment } from './entities/road-segment.entity';
import { RoadEvalController } from './road-eval.controller';
import { RoadEvalService } from './road-eval.service';

@Module({
  imports: [TypeOrmModule.forFeature([RoadSegment])],
  controllers: [RoadEvalController],
  providers: [RoadEvalService],
  exports: [RoadEvalService]
})
export class RoadEvalModule {}
