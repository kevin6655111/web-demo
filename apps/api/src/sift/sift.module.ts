import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { StorageModule } from '@/storage/storage.module';
import { CaseHistoryModule } from '@/case-history/case-history.module';
import { SiftController } from './sift.controller';
import { SiftService } from './sift.service';

/**
 * 二篩：AI 判讀結果的人工確認。
 *
 * 不新增資料表 —— 二篩結果就是 `patrol_case_statuses` 的一部分。
 * 另存一份的話，「這個案件現在是什麼狀態」會有兩個答案。
 */
@Module({
  imports: [TypeOrmModule.forFeature([PatrolCase, PatrolCaseStatus]), StorageModule, CaseHistoryModule],
  controllers: [SiftController],
  providers: [SiftService],
  exports: [SiftService]
})
export class SiftModule {}
