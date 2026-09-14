import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';

/**
 * 巡查的每日結算。
 *
 * 維度是 (日期, 標案, 縣市, 行政區) —— 請款與履約檢核都按行政區結算，
 * 而看板要的是「這個月每天的量」。即時算要掃整月的軌跡點與案件，
 * 一次幾秒鐘，而看板是掛在牆上整天刷新的。
 *
 * 破壞類型各一個欄位而不是一張明細表：這張表只服務看板與月報，
 * 兩者要的都是「各類型幾件」，而類型的數量是固定的七種。
 */
@Entity({ name: 'dashboard_case_stats' })
@Unique('uq_dashboard_case_stat', ['company', 'statDate', 'project', 'district'])
@Index('idx_dashboard_case_stat_date', ['company', 'statDate'])
export class DashboardCaseStat {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'stat_date', type: 'date' })
  statDate!: string;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'mileage_km', type: 'numeric', precision: 10, scale: 2, default: 0 })
  mileageKm!: string;

  /** 該範圍當天有巡查紀錄的車輛數；「巡查天數」的月累計由它加總 */
  @Column({ name: 'patrol_days', type: 'int', default: 0 })
  patrolDays!: number;

  @Column({ name: 'case_total', type: 'int', default: 0 })
  caseTotal!: number;

  @Column({ name: 'pothole', type: 'int', default: 0 })
  pothole!: number;

  @Column({ name: 'alligator_crack', type: 'int', default: 0 })
  alligatorCrack!: number;

  @Column({ name: 'linear_crack', type: 'int', default: 0 })
  linearCrack!: number;

  @Column({ name: 'patch', type: 'int', default: 0 })
  patch!: number;

  @Column({ name: 'manhole_cover', type: 'int', default: 0 })
  manholeCover!: number;

  /** 車轍與路基下陷等其餘類型；分開列會讓欄位跟著代碼表無限成長 */
  @Column({ name: 'other_crack', type: 'int', default: 0 })
  otherCrack!: number;

  @Column({ name: 'area_m2', type: 'numeric', precision: 12, scale: 2, default: 0 })
  areaM2!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
