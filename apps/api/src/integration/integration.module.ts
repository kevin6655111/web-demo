import { Module } from '@nestjs/common';
import { CasePatrolModule } from '@/case-patrol/case-patrol.module';
import { FleetModule } from '@/fleet/fleet.module';
import { SurveyModule } from '@/survey/survey.module';
import { DeviceController } from './device.controller';
import { MobileController } from './mobile.controller';

/**
 * 對外介接介面。
 *
 * 車機與行動應用上傳的端點集中在這裡，而不是散在各領域模組的 controller 裡。
 *
 * 兩個理由：
 *
 * 1. **文件的內容隔離靠 tag**，而 `@ApiTags` 在 class 層與 method 層是疊加的 ——
 *    留在原本的 controller 裡，端點會同時屬於內部章節與對外章節，
 *    對外文件的過濾結果就無法預期。
 *
 * 2. **「我們對外開了什麼」應該看一個目錄就回答得了**。散在各處的話，
 *    要確認有沒有不該開放的端點被加上 `@AllowApiKey()`，得掃過整個 src。
 *
 * 服務本身仍在各領域模組裡：這一層只有 controller，沒有業務邏輯。
 */
@Module({
  imports: [CasePatrolModule, FleetModule, SurveyModule],
  controllers: [DeviceController, MobileController]
})
export class IntegrationModule {}
