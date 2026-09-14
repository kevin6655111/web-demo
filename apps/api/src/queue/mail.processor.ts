import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { MailJob } from '@/mail/entities/mail-job.entity';
import { MailTransport } from '@/mail/mail.transport';
import { QUEUE, type MailJobPayload } from './queue.const';

/**
 * 郵件佇列的消費端。
 *
 * 工作內容只有 id，郵件本文以資料庫為準 —— 重送時才能確定用的是同一份文字。
 *
 * 失敗時**拋出例外而非回傳失敗**：BullMQ 依此決定是否重試。
 * 自行吞掉例外會讓重試機制完全失效，而 SMTP 故障多半是暫時的。
 */
@Processor(QUEUE.MAIL, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger('MailQueue');

  constructor(
    @InjectRepository(MailJob) private readonly mailRepo: Repository<MailJob>,
    private readonly transport: MailTransport
  ) {
    super();
  }

  async process(job: Job<MailJobPayload>): Promise<void> {
    const { mailJobId } = job.data;

    const mail = await this.mailRepo.findOne({ where: { id: mailJobId } });
    if (!mail) {
      // 郵件已被刪除：這不是錯誤，不該重試
      this.logger.warn(`郵件 #${mailJobId} 已不存在，略過`);
      return;
    }

    await this.mailRepo.increment({ id: mailJobId }, 'attempts', 1);

    try {
      const result = await this.transport.send(mail.toAddress, mail.subject, mail.body);

      await this.mailRepo.update(
        { id: mailJobId },
        { state: 'SENT', sentAt: new Date(), lastError: result.delivered ? undefined : result.detail }
      );

      this.logger.log(`${result.delivered ? '✅' : '📭'} #${mailJobId} ${mail.subject} → ${mail.toAddress}`);
    } catch (error: any) {
      const detail = String(error?.message ?? error).slice(0, 500);
      await this.mailRepo.update({ id: mailJobId }, { state: 'FAILED', lastError: detail });

      this.logger.error(`❌ #${mailJobId} 寄送失敗：${detail}`);
      throw error; // 交回 BullMQ 決定重試
    }
  }
}
