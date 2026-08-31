import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { Project } from '@/project/entities/project.entity';

/** 車輛用途 */
export const VEHICLE_TYPE = ['PATROL', 'REPAIR', 'SURVEY'] as const;
export type VehicleType = (typeof VEHICLE_TYPE)[number];

/** 車機狀態；離線與停用不同 —— 離線是「現在沒訊號」，停用是「這台車不跑了」 */
export const VEHICLE_STATE = ['ONLINE', 'IDLE', 'OFFLINE', 'DISABLED'] as const;
export type VehicleState = (typeof VEHICLE_STATE)[number];

/** 車輛 */
@Entity({ name: 'vehicles' })
@Unique('uq_vehicle_plate', ['company', 'plateNo'])
@Index('idx_vehicle_company_state', ['company', 'state'])
export class Vehicle {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'plate_no', type: 'varchar', length: 15 })
  plateNo!: string;

  @Column({ name: 'name', type: 'varchar', length: 30, nullable: true })
  name?: string;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 10, default: 'PATROL' })
  vehicleType!: VehicleType;

  @Column({ name: 'state', type: 'varchar', length: 10, default: 'OFFLINE' })
  state!: VehicleState;

  /** 車機識別碼；車機上傳軌跡時用這個而不是車牌(車牌會換) */
  @Column({ name: 'device_id', type: 'varchar', length: 40, nullable: true })
  deviceId?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'driver_id' })
  driver?: User;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  /** 最後回報的位置與時間；即時位置在 Redis，這裡留最後一筆做離線判斷 */
  @Column({ name: 'last_lng', type: 'double precision', nullable: true })
  lastLng?: number;

  @Column({ name: 'last_lat', type: 'double precision', nullable: true })
  lastLat?: number;

  @Column({ name: 'last_report_at', type: 'timestamptz', nullable: true })
  lastReportAt?: Date;

  @Column({ name: 'today_km', type: 'numeric', precision: 8, scale: 2, default: 0 })
  todayKm!: string;

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
