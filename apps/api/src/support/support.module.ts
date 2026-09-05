import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportThread } from './entities/support-thread.entity';
import { SupportMessage } from './entities/support-message.entity';
import { QueueModule } from '@/queue/queue.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [TypeOrmModule.forFeature([SupportThread, SupportMessage]), QueueModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService]
})
export class SupportModule {}
