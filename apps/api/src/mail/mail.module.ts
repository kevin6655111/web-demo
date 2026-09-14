import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailJob } from './entities/mail-job.entity';
import { QueueModule } from '@/queue/queue.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { MailTransport } from './mail.transport';

@Module({
  imports: [TypeOrmModule.forFeature([MailJob]), QueueModule],
  controllers: [MailController],
  providers: [MailService, MailTransport],
  exports: [MailService, MailTransport]
})
export class MailModule {}
