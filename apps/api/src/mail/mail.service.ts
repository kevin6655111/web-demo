import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { QUEUE, type MailJobPayload } from '@/queue/queue.const';
import { MailJob } from './entities/mail-job.entity';
import { MAIL_TEMPLATES, type MailTemplateKey } from './mail.template';

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');

  constructor(
    @InjectRepository(MailJob) private readonly mailRepo: Repository<MailJob>,
    @InjectQueue(QUEUE.MAIL) private readonly mailQueue: Queue<MailJobPayload>
  ) {}

  /**
   * 排入一封郵件。
   *
   * **先落地再排隊**：內容寫進資料庫之後才把 id 丟進佇列。
   * 反過來的話，佇列取出工作時內容可能還沒寫完；而佇列工作只帶 id、
   * 不帶內容，重送時才能確定用的是同一份文字。
   */
  public async enqueue(template: MailTemplateKey, to: string, params: Record<string, string>): Promise<MailJob> {
    const { subject, render } = MAIL_TEMPLATES[template];

    const job = await this.mailRepo.save(
      this.mailRepo.create({
        toAddress: to,
        subject: subject(params),
        body: render(params),
        template,
        state: 'PENDING'
      })
    );

    // jobId 綁資料列 id：同一封信被重複排入時，佇列只會保留一份
    await this.mailQueue.add(QUEUE.MAIL, { mailJobId: job.id }, { jobId: `mail-${job.id}` });
    this.logger.log(`📧 已排入 #${job.id} ${template} → ${to}`);

    return job;
  }

  /** 郵件工作清單，新到舊 */
  public async list(state?: string, limit = 100): Promise<HttpResult> {
    const qb = this.mailRepo.createQueryBuilder('m').orderBy('m.createdAt', 'DESC').take(limit);
    if (state) qb.where('m.state = :state', { state });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((m) => ({
        ID: m.id,
        TO: m.toAddress,
        SUBJECT: m.subject,
        TEMPLATE: m.template,
        STATE: m.state,
        ATTEMPTS: m.attempts,
        LAST_ERROR: m.lastError ?? null,
        SENT_AT: m.sentAt ?? null,
        CREATED_AT: m.createdAt
      })),
      warnMsg: '沒有郵件工作'
    });
  }

  /** 單封郵件的完整內容；未設定 SMTP 時，這裡就是實際的「收件匣」 */
  public async detail(id: number): Promise<HttpResult> {
    const job = await this.mailRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`找不到郵件工作：${id}`);

    return HttpResponse.success({
      data: {
        ID: job.id,
        TO: job.toAddress,
        SUBJECT: job.subject,
        BODY: job.body,
        TEMPLATE: job.template,
        STATE: job.state,
        ATTEMPTS: job.attempts,
        LAST_ERROR: job.lastError ?? null,
        SENT_AT: job.sentAt ?? null,
        CREATED_AT: job.createdAt
      }
    });
  }

  /**
   * 重送。
   *
   * 重設為 PENDING 後重新排入佇列。`attempts` 不歸零 ——
   * 那個數字要回答的是「這封信總共試了幾次」，歸零之後就答不出來了。
   */
  public async retry(id: number): Promise<HttpResult> {
    const job = await this.mailRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`找不到郵件工作：${id}`);

    await this.mailRepo.update({ id }, { state: 'PENDING', lastError: undefined });

    // 移除舊的佇列工作，否則相同 jobId 會被視為重複而略過
    await this.mailQueue.remove(`mail-${id}`).catch(() => undefined);
    await this.mailQueue.add(QUEUE.MAIL, { mailJobId: id }, { jobId: `mail-${id}` });

    return HttpResponse.success({ message: `郵件 #${id} 已重新排入佇列` });
  }

  /** 刪除；佇列中尚未執行的工作一併移除 */
  public async remove(id: number): Promise<HttpResult> {
    const result = await this.mailRepo.delete({ id });
    if (!result.affected) throw new NotFoundException(`找不到郵件工作：${id}`);

    await this.mailQueue.remove(`mail-${id}`).catch(() => undefined);

    return HttpResponse.success({ message: `郵件 #${id} 已刪除` });
  }

  /** 各狀態的計數；儀表板與維運用 */
  public async stats(): Promise<Record<string, number>> {
    const rows = await this.mailRepo
      .createQueryBuilder('m')
      .select('m.state', 'state')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('m.state')
      .getRawMany<{ state: string; count: number }>();

    return Object.fromEntries(rows.map((r) => [r.state, Number(r.count)]));
  }
}
