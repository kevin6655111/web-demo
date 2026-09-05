import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { SupportMessage } from './support-message.entity';

export const SUPPORT_STATE = ['OPEN', 'ASSIGNED', 'RESOLVED', 'CLOSED'] as const;
export type SupportState = (typeof SUPPORT_STATE)[number];

/** 問題分類：客服看到分類就知道要不要轉給工程 */
export const SUPPORT_CATEGORY = ['ACCOUNT', 'CASE', 'DEVICE', 'REPORT', 'OTHER'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORY)[number];

/**
 * 客服對話。
 *
 * 一位使用者同時只會有一條開啟中的對話 —— 現場人員遇到問題時要的是
 * 「有人回我」，不是「開一張新單」。已結案的對話會保留，
 * 再次發問時開新的一條，這樣客服看得到這個人上次問過什麼。
 */
@Entity({ name: 'support_threads' })
@Index('idx_support_company_state', ['company', 'state'])
@Index('idx_support_requester', ['requester'])
export class SupportThread {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requester_id' })
  requester!: User;

  /** 接手的客服；未指派時任何有客服權限的人都看得到 */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agent_id' })
  agent?: User;

  @Column({ name: 'subject', type: 'varchar', length: 100 })
  subject!: string;

  @Column({ name: 'category', type: 'varchar', length: 10, default: 'OTHER' })
  category!: SupportCategory;

  @Column({ name: 'state', type: 'varchar', length: 10, default: 'OPEN' })
  state!: SupportState;

  /** 最後一則訊息的時間；客服清單依此排序，不必每次都 join 訊息表 */
  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt?: Date;

  /** 使用者未讀數與客服未讀數分開算：兩邊看到的紅點意義不同 */
  @Column({ name: 'unread_for_user', type: 'int', default: 0 })
  unreadForUser!: number;

  @Column({ name: 'unread_for_agent', type: 'int', default: 0 })
  unreadForAgent!: number;

  @OneToMany(() => SupportMessage, (m) => m.thread)
  messages!: SupportMessage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
