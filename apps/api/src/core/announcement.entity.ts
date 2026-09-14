import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';

export const ANNOUNCEMENT_LEVEL = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVEL)[number];

/**
 * 系統公告。
 *
 * 停機維護、車機韌體更新、颱風停工 —— 這些訊息如果只發群組訊息，
 * 沒看到的人就是沒看到。放在系統裡，登入就會看到。
 */
@Entity({ name: 'announcements' })
@Index('idx_announcement_active', ['company', 'startAt', 'endAt'])
export class Announcement {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'title', type: 'varchar', length: 100 })
  title!: string;

  @Column({ name: 'body', type: 'varchar', length: 1000 })
  body!: string;

  @Column({ name: 'level', type: 'varchar', length: 10, default: 'INFO' })
  level!: AnnouncementLevel;

  /** 生效期間；過期的公告自動不再顯示，不需要有人記得去關掉 */
  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt!: Date;

  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt?: Date;

  /** 置頂公告顯示在最前面，且不能被使用者關掉 */
  @Column({ name: 'pinned', type: 'boolean', default: false })
  pinned!: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
