import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { TilesController } from './tiles.controller';
import { TilesService } from './tiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolCase])],
  controllers: [TilesController],
  providers: [TilesService],
  exports: [TilesService]
})
export class TilesModule {}
