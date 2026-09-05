import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';
import { Vehicle } from '@/fleet/entities/vehicle.entity';

/** 巡查頻率 */
export const PATROL_FREQUENCY = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type PatrolFrequency = (typeof PATROL_FREQUENCY)[number];

/**
 * 巡查計畫。
 *
 * 契約通常寫「每條路每週至少巡一次」，所以系統要知道兩件事：
 * 該巡哪些路（route 幾何）、多久巡一次（frequency）。
 * 有了這兩者才能算覆蓋率 —— 也就是「這週有沒有把該巡的都巡完」。
 */
@Entity({ name: 'patrol_plans' })
@Unique('uq_plan_code', ['company', 'code'])
@Index('idx_plan_company_active', ['company', 'active'])
export class PatrolPlan {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 60 })
  name!: string;

  @Column({ name: 'frequency', type: 'varchar', length: 10, default: 'WEEKLY' })
  frequency!: PatrolFrequency;

  /** 指派車輛；未指派的計畫只是規劃，不會被算進覆蓋率 */
  @ManyToOne(() => Vehicle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle?: Vehicle;

  /** 巡查路線 */
  @Index('idx_plan_geom', { spatial: true })
  @Column({ name: 'route', type: 'geography', spatialFeatureType: 'LineString', srid: 4326 })
  route!: { type: 'LineString'; coordinates: [number, number][] };

  @Column({ name: 'route_km', type: 'numeric', precision: 8, scale: 2, default: 0 })
  routeKm!: string;

  /** 覆蓋率判定的緩衝距離(公尺)：車走在對向車道也算巡過 */
  @Column({ name: 'buffer_m', type: 'int', default: 30 })
  bufferM!: number;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
