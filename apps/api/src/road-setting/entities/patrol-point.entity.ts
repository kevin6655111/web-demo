import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';

/**
 * 應巡查點。
 *
 * 契約常寫「這些路口每週至少要看一次」—— 那是點而不是線，
 * 用路線覆蓋率算不出來：一條路線的 90% 覆蓋率，可能正好漏掉了
 * 業主最在意的那個路口。
 *
 * `radius_m` 是判定半徑：車輛的軌跡點落在這個範圍內就算巡到。
 * 每個點各自設定，因為大路口與小巷口的合理範圍不同。
 */
@Entity({ name: 'patrol_points' })
@Unique('uq_patrol_point_code', ['company', 'code'])
export class PatrolPoint {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'road_name', type: 'varchar', length: 100, nullable: true })
  roadName?: string;

  /** 判定半徑(公尺)：軌跡點落在這個範圍內就算巡到 */
  @Column({ name: 'radius_m', type: 'int', default: 30 })
  radiusM!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Index('idx_patrol_point_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  geom!: { type: 'Point'; coordinates: [number, number] };

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
