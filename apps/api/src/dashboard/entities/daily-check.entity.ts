import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';

/**
 * 每日上傳檢查。
 *
 * 督導早上要回答一個問題：「昨天每一台車都有正常上傳嗎」。
 * 沒有這張表的話，那個問題要靠人去翻案件清單、按車牌分組、
 * 再跟出勤表對照 —— 而漏傳通常要等到月底對帳才會被發現。
 *
 * `image_missing` 是逐筆問物件儲存得到的：案件有 `img` 欄位不代表檔案真的上傳成功，
 * 車機在收訊差的地方常常送出了紀錄卻沒送出照片。
 */
@Entity({ name: 'daily_checks' })
@Unique('uq_daily_check', ['company', 'checkDate', 'project', 'car', 'district'])
@Index('idx_daily_check_date', ['company', 'checkDate'])
export class DailyCheck {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'check_date', type: 'date' })
  checkDate!: string;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ name: 'car', type: 'varchar', length: 20, default: '(未指定)' })
  car!: string;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'case_count', type: 'int', default: 0 })
  caseCount!: number;

  @Column({ name: 'image_total', type: 'int', default: 0 })
  imageTotal!: number;

  /** 有紀錄但檔案不在物件儲存上的張數 */
  @Column({ name: 'image_missing', type: 'int', default: 0 })
  imageMissing!: number;

  /** 當天該車的軌跡點數：案件是 0 時要分得出「沒出車」與「出車但沒發現」 */
  @Column({ name: 'track_points', type: 'int', default: 0 })
  trackPoints!: number;

  @Column({ name: 'first_at', type: 'timestamptz', nullable: true })
  firstAt?: Date;

  @Column({ name: 'last_at', type: 'timestamptz', nullable: true })
  lastAt?: Date;

  /** 是否已同步到外部系統（Demo 沒有外部系統，固定為 false） */
  @Column({ name: 'uploaded', type: 'boolean', default: false })
  uploaded!: boolean;

  @Column({ name: 'note', type: 'varchar', length: 200, nullable: true })
  note?: string;

  @Column({ name: 'checked_at', type: 'timestamptz', default: () => 'now()' })
  checkedAt!: Date;
}
