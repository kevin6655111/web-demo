import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from '@/fleet/entities/vehicle.entity';
import { AuthModule } from '@/auth/auth.module';
import { VehicleCommController } from './vehicle-comm.controller';
import { VehicleCommService } from './vehicle-comm.service';
import { VehicleCommGateway } from './vehicle-comm.gateway';
import { DeviceSimulatorService } from './device-simulator.service';

/**
 * 車機通訊。
 *
 * 與 `fleet` 的分工：`fleet` 管「車輛這個資料」(車牌、駕駛、軌跡)，
 * 這裡管「車機這條連線」(現在通不通、車子的即時狀態、能不能下指令)。
 *
 * 分開的實際理由是**壞的方式不同**：軌跡寫入失敗要重試，
 * 連線斷掉只要記錄下來；把它們放在一起，會讓「車輛」這個模組
 * 同時背著高頻寫入與長連線兩種完全不同的負擔。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Vehicle]), AuthModule],
  controllers: [VehicleCommController],
  providers: [VehicleCommService, VehicleCommGateway, DeviceSimulatorService],
  exports: [VehicleCommService]
})
export class VehicleCommModule {}
