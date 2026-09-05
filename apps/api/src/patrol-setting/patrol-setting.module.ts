import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolPlan } from './entities/patrol-plan.entity';
import { PatrolSettingController } from './patrol-setting.controller';
import { PatrolSettingService } from './patrol-setting.service';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolPlan])],
  controllers: [PatrolSettingController],
  providers: [PatrolSettingService],
  exports: [PatrolSettingService]
})
export class PatrolSettingModule {}
