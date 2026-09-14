import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 郵件工作狀態 */
export const MAIL_STATE = ['PENDING', 'SENT', 'FAILED'] as const;
export type MailState = (typeof MAIL_STATE)[number];

/**
 * 郵件工作。
 *
 * 郵件內容落地保存，而非僅存在於佇列中。理由有三：
 *
 * 1. **可稽核**：「系統有沒有寄出通知」是會被追問的問題，
 *    佇列完成後即清除工作，事後無從查證。
 * 2. **可重送**：SMTP 暫時故障時，需要能指定重送哪幾封，
 *    而非重跑整批。
 * 3. **可檢視**：Demo 未設定 SMTP 時以此表取代實際寄送，
 *    收件內容仍可在管理介面查看。
 */
@Entity({ name: 'mail_jobs' })
@Index('idx_mail_job_state', ['state', 'createdAt'])
export class MailJob {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'to_address', type: 'varchar', length: 200 })
  toAddress!: string;

  @Column({ name: 'subject', type: 'varchar', length: 200 })
  subject!: string;

  /** 郵件本文（HTML）；保留原文以便重送與稽核 */
  @Column({ name: 'body', type: 'text' })
  body!: string;

  /** 樣板代碼，例如 `PASSWORD_CHANGED`；供統計「哪一類通知最常失敗」 */
  @Column({ name: 'template', type: 'varchar', length: 40 })
  template!: string;

  @Column({ name: 'state', type: 'varchar', length: 10, default: 'PENDING' })
  state!: MailState;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  /** 最後一次失敗的原因；成功後清空 */
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError?: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
