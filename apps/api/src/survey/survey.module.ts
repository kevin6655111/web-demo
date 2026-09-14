import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurveyOrder } from './entities/survey-order.entity';
import { SurveyCase } from './entities/survey-case.entity';
import { SurveyOrderDetail } from './entities/survey-order-detail.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { CaseEncodeModule } from '@/case-encode/case-encode.module';
import { CaseHistoryModule } from '@/case-history/case-history.module';
import { StorageModule } from '@/storage/storage.module';
import { SurveyController } from './survey.controller';
import { SurveyService } from './survey.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SurveyOrder, SurveyOrderDetail, SurveyCase, RoadSegment]),
    CaseEncodeModule,
    CaseHistoryModule,
    StorageModule
  ],
  controllers: [SurveyController],
  providers: [SurveyService],
  exports: [SurveyService]
})
export class SurveyModule {}
