import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';

export const REPORT_FORMAT = ['XLSX', 'DOCX'] as const;
export type ReportFormat = (typeof REPORT_FORMAT)[number];

export const REPORT_STATE = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export type ReportState = (typeof REPORT_STATE)[number];

/**
 * 報表工作。
 *
 * 報表是「要等的東西」，所以它有自己的一張表：
 * 使用者關掉瀏覽器、worker 重啟、隔天再回來下載，狀態都還在。
 * 只把工作丟進佇列而不落地，重啟後就沒人知道這份報表存在過。
 */
@Entity({ name: 'report_jobs' })
@Unique('uq_report_dedup_key', ['dedupKey'])
@Index('idx_report_company_state', ['company', 'state'])
export class ReportJob {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requester_id' })
  requester?: User;

  /**
   * 去重鍵：公司 + 格式 + 查詢條件的雜湊。
   * 同樣條件的報表在完成前重複請求，直接回同一筆工作而不是再排一份。
   */
  @Column({ name: 'dedup_key', type: 'varchar', length: 80 })
  dedupKey!: string;

  @Column({ name: 'format', type: 'varchar', length: 10 })
  format!: ReportFormat;

  @Column({ name: 'state', type: 'varchar', length: 10, default: 'PENDING' })
  state!: ReportState;

  /** 產生報表用的查詢條件，原樣存起來以便重跑 */
  @Column({ name: 'params', type: 'jsonb' })
  params!: Record<string, unknown>;

  @Column({ name: 'row_count', type: 'integer', default: 0 })
  rowCount!: number;

  /** 產出物在 MinIO 的 key */
  @Column({ name: 'file_key', type: 'varchar', length: 200, nullable: true })
  fileKey?: string;

  @Column({ name: 'error', type: 'text', nullable: true })
  error?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
