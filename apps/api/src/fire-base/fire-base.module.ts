import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { FireBaseController } from './fire-base.controller';
import { FireBaseService } from './fire-base.service';

/**
 * 設為 Global：派工、逾期提醒、報表完成分屬不同模組，都需要推播。
 * 各自 import 一次只是重複，而漏掉的那個會改用別的方式通知使用者。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken])],
  controllers: [FireBaseController],
  providers: [FireBaseService],
  exports: [FireBaseService]
})
export class FireBaseModule {}
