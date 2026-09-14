import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule } from '@/env/env.module';
import { UtilModule } from '@/util/util.module';
import { RedisModule } from '@/redis/redis.module';
import { DatabaseModule } from '@/database.module';
import { BullRootModule } from '@/queue/bull-root.module';
import { MailProcessor } from '@/queue/mail.processor';
import { MailTransport } from '@/mail/mail.transport';
import { QUEUE } from '@/queue/queue.const';
import { MailJob } from '@/mail/entities/mail-job.entity';

/**
 * mail-worker 行程：只寄郵件。
 *
 * 與其他 worker 分開的理由是失敗模式不同：SMTP 故障時，郵件工作會長時間卡住並反覆重試，
 * 而案件處理與報表產製不應受其影響。
 *
 * 同時它是最不吃資源的一個行程 —— 與報表放在一起的話，
 * 記憶體上限必須遷就報表，等於為了幾 KB 的郵件保留幾百 MB。
 */
@Module({
  imports: [
    EnvModule,
    UtilModule,
    RedisModule,
    DatabaseModule,
    BullRootModule,
    BullModule.registerQueue({ name: QUEUE.MAIL }),
    TypeOrmModule.forFeature([MailJob])
  ],
  providers: [MailProcessor, MailTransport]
})
export class MailWorkerModule {}
