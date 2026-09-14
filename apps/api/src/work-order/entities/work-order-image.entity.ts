import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';
import { WorkOrder } from './work-order.entity';
import { User } from '@entities/user.entity';

/**
 * 派工單照片。
 *
 * 每張照片有固定類型（施工前／刨除後／壓實度檢測…），
 * 而且**同一類型只留一張** —— 驗收要的是「這個階段的照片」，
 * 不是同一階段的二十張。要留全部就用 ZIP 類型。
 *
 * 存 key 而不是 URL：換 endpoint 或簽名策略時不必改資料。
 */
@Entity({ name: 'work_order_images' })
@Unique('uq_work_order_image_type', ['workOrder', 'imgType'])
@Index('idx_work_order_image_order', ['workOrder'])
export class WorkOrderImage {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => WorkOrder, (w) => w.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_order_id' })
  workOrder!: WorkOrder;

  @Column({ name: 'img_type', type: 'varchar', length: 50 })
  imgType!: string;

  /** 中文名一併存下來：報表產出時不必再查一次對照表 */
  @Column({ name: 'img_type_ch', type: 'varchar', length: 50 })
  imgTypeCh!: string;

  @Column({ name: 'img_name', type: 'varchar', length: 150 })
  imgName!: string;

  /** 物件儲存的 key */
  @Column({ name: 'img_path', type: 'varchar', length: 250 })
  imgPath!: string;

  @Column({ name: 'size_bytes', type: 'int', default: 0 })
  sizeBytes!: number;

  @Column({ name: 'mime_type', type: 'varchar', length: 60, nullable: true })
  mimeType?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy?: User;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;
}
