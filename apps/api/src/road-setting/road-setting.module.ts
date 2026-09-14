import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoadLine } from './entities/road-line.entity';
import { RoadBlock } from './entities/road-block.entity';
import { PatrolPoint } from './entities/patrol-point.entity';
import { PatrolPointStat } from './entities/patrol-point-stat.entity';
import { RoadSettingController } from './road-setting.controller';
import { RoadSettingService } from './road-setting.service';

/**
 * 道路設定與巡查點。
 *
 * 與 `patrol-setting` 的分工：後者管「該走哪條路線」(巡查計畫)，
 * 這裡管「路網長什麼樣、哪些納入範圍、哪些點一定要到」。
 * 覆蓋率也是兩種 —— 路線覆蓋率看的是走過多少比例的路線，
 * 點位覆蓋率看的是指定的點到了幾個。
 */
@Module({
  imports: [TypeOrmModule.forFeature([RoadLine, RoadBlock, PatrolPoint, PatrolPointStat])],
  controllers: [RoadSettingController],
  providers: [RoadSettingService],
  exports: [RoadSettingService]
})
export class RoadSettingModule {}
