import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { WorkOrder } from './work-order.entity';
import { User } from '@entities/user.entity';

/**
 * 派工單的施工人員（一張單可以派多人）。
 *
 * 原本是主表上的一個 `worker_user_id` —— 但現場一個坑洞常是兩三個人一起去，
 * 用逗號串在一個欄位裡會讓「這個人這個月被派了幾張單」變成字串比對。
 *
 * 沒有指派人員是合法狀態：現場常是先開單、隔天早上點名才分工。
 * 「未指定」不會在這張表留下任何列，對外以 id 0 表示。
 */
@Entity({ name: 'work_order_users' })
@Unique('uq_work_order_user', ['workOrder', 'user'])
@Index('idx_work_order_user_user', ['user'])
export class WorkOrderUser {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => WorkOrder, (w) => w.workers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_order_id' })
  workOrder!: WorkOrder;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
