import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Maintenance } from './maintenance.entity';
import { User } from '@entities/user.entity';

/**
 * 巡查單照片。
 *
 * 規則與派工單照片一致：欄位名就是類型，同一類型只留一張，存 key 不存 URL。
 * 兩張表分開而不是共用一張加 case_type —— 共用表的外鍵沒辦法設成 CASCADE，
 * 刪一張單就會留下一堆指向不存在的列。
 */
@Entity({ name: 'maintenance_images' })
@Unique('uq_maintenance_image_type', ['maintenance', 'imgType'])
@Index('idx_maintenance_image_case', ['maintenance'])
export class MaintenanceImage {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Maintenance, (m) => m.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'maintenance_id' })
  maintenance!: Maintenance;

  @Column({ name: 'img_type', type: 'varchar', length: 50 })
  imgType!: string;

  @Column({ name: 'img_type_ch', type: 'varchar', length: 50 })
  imgTypeCh!: string;

  @Column({ name: 'img_name', type: 'varchar', length: 150 })
  imgName!: string;

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
