import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { WorkOrder } from './work-order.entity';
import { User } from '@entities/user.entity';

/**
 * 派工單狀態。
 *
 * 0 待處理 / 1 施工中 / 2 已回報 / 3 已完工
 *
 * 與主表分開的理由和案件一樣：主表在派工後幾乎不動，
 * 狀態則會被施工人員與驗收人員反覆改 —— 而且要記錄「誰改的」。
 */
@Entity({ name: 'work_order_statuses' })
@Unique('uq_work_order_status', ['workOrder'])
@Index('idx_work_order_status_value', ['status'])
export class WorkOrderStatus {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @OneToOne(() => WorkOrder, (w) => w.status, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_order_id' })
  workOrder!: WorkOrder;

  @Column({ name: 'status', type: 'int', default: 0 })
  status!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'upd_status_usr' })
  updStatusUsr?: User;

  @UpdateDateColumn({ name: 'upd_status_at', type: 'timestamptz', nullable: true })
  updStatusAt?: Date;

  /** 驗收不合格時的退回原因；合格時為空 */
  @Column({ name: 'reject_reason', type: 'varchar', length: 250, nullable: true })
  rejectReason?: string;
}
