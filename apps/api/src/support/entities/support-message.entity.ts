import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '@entities/user.entity';
import { SupportThread } from './support-thread.entity';

/** 客服訊息 */
@Entity({ name: 'support_messages' })
@Index('idx_support_msg_thread', ['thread', 'createdAt'])
export class SupportMessage {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => SupportThread, (t) => t.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'thread_id' })
  thread!: SupportThread;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_id' })
  sender?: User;

  /** 發話方；用欄位而不是「sender 是不是 requester」判斷，因為客服可能換人接手 */
  @Column({ name: 'from_agent', type: 'boolean', default: false })
  fromAgent!: boolean;

  @Column({ name: 'body', type: 'varchar', length: 1000 })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
