import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '@entities/user.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';

/**
 * 案件討論訊息。
 *
 * 即時通訊的內容一定要落地：現場師傅在隧道裡斷線三分鐘，
 * 回來時要看得到這段時間辦公室說了什麼。
 * 只靠 WebSocket 廣播的聊天室，斷線就等於訊息消失。
 */
@Entity({ name: 'case_messages' })
@Index('idx_message_case_created', ['patrolCase', 'createdAt'])
export class CaseMessage {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => PatrolCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  patrolCase!: PatrolCase;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_id' })
  sender?: User;

  @Column({ name: 'body', type: 'varchar', length: 500 })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
