import { Module } from '@nestjs/common';
import { StorageModule } from '@/storage/storage.module';
import { GeoModule } from '@/geo/geo.module';
import { InitProcessService } from './init-process.service';

/**
 * 開機自檢。
 *
 * 只在 `api` 行程掛載：worker 與 scheduler 共用同一組外部依賴，
 * 每個行程各檢查一次只是把同樣的訊息印四遍。
 */
@Module({
  imports: [StorageModule, GeoModule],
  providers: [InitProcessService]
})
export class InitProcessModule {}
