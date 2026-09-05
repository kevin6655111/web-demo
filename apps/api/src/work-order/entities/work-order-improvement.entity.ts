import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { WorkOrder } from './work-order.entity';

/**
 * 路基改善的取樣資訊。
 *
 * 只有 PB（路基改善）類型才有，所以獨立一張表 ——
 * 放進主表的話，另外三種類型會有三個永遠是 null 的欄位，
 * 而「PB 一定要有取樣資訊」這條規則也就無法用 NOT NULL 表達。
 */
@Entity({ name: 'work_order_improvements' })
@Unique('uq_work_order_improvement', ['workOrder'])
export class WorkOrderImprovement {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @OneToOne(() => WorkOrder, (w) => w.improvement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_order_id' })
  workOrder!: WorkOrder;

  @Column({ name: 'sample_taken', type: 'boolean', default: false })
  sampleTaken!: boolean;

  @Column({ name: 'sample_date', type: 'date', nullable: true })
  sampleDate?: string;

  /** 試驗項目：壓實度、厚度、瀝青含量… */
  @Column({ name: 'test_item', type: 'jsonb', nullable: true })
  testItem?: string[];

  @Column({ name: 'test_result', type: 'varchar', length: 250, nullable: true })
  testResult?: string;
}
