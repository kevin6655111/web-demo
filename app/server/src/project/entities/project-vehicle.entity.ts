import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Project } from './project.entity';
import { Vehicle } from '@/fleet/entities/vehicle.entity';

/**
 * 標案-車輛關聯。
 *
 * 一台車會跑多個標案，一個標案也會有多台車 —— 所以是多對多。
 * 車機上傳案件時帶的是車號，系統要靠這張表判斷「這筆案件算哪個標案的」。
 *
 * 同樣用 `isActive` 而非刪除：車輛調度到別的標案後，
 * 舊標案的歷史案件仍然要能追回當時是哪台車跑的。
 */
@Entity({ name: 'project_vehicles' })
@Unique('uq_project_vehicle', ['project', 'vehicle'])
@Index('idx_project_vehicle_active', ['project', 'vehicle', 'isActive'])
export class ProjectVehicle {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Project, (p) => p.projectVehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @ManyToOne(() => Vehicle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: Vehicle;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
