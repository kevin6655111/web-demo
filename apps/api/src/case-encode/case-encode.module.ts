import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseSequence } from './entities/case-sequence.entity';
import { CaseEncodeService } from './case-encode.service';

/**
 * 案件編號。
 *
 * 設成 Global：車巡案件、巡查單、派工單都要取號，而它們分屬不同模組。
 * 每個模組各自 import 一次只是重複，而且漏掉的那個會自己寫一份取號邏輯 ——
 * 那正是這個模組要消滅的東西。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([CaseSequence])],
  providers: [CaseEncodeService],
  exports: [CaseEncodeService]
})
export class CaseEncodeModule {}
