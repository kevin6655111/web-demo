import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Announcement } from './announcement.entity';
import { CoreController } from './core.controller';
import { CoreService } from './core.service';

@Module({
  imports: [TypeOrmModule.forFeature([Announcement])],
  controllers: [CoreController],
  providers: [CoreService],
  exports: [CoreService]
})
export class CoreModule {}
