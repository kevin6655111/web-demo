import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurveyOrder } from './entities/survey-order.entity';
import { SurveyCase } from './entities/survey-case.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { SurveyController } from './survey.controller';
import { SurveyService } from './survey.service';

@Module({
  imports: [TypeOrmModule.forFeature([SurveyOrder, SurveyCase, RoadSegment])],
  controllers: [SurveyController],
  providers: [SurveyService],
  exports: [SurveyService]
})
export class SurveyModule {}
