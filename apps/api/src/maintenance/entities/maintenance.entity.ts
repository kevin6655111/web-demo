import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { Project } from '@/project/entities/project.entity';
import { MaintenanceStatus } from './maintenance-status.entity';
import { MaintenanceRepair } from './maintenance-repair.entity';
import { MaintenanceImage } from './maintenance-image.entity';

/** 巡查單類型：RA 巡查（只記錄）/ RB 巡修（當場修掉） */
export const MAINTENANCE_TYPE = ['RA', 'RB'] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPE)[number];

/**
 * 巡查單／巡修單。
 *
 * 與 AI 車巡案件的差別在「誰發現的」：車巡案件由車機與判讀模型產出，
 * 巡查單是人在現場開的 —— 所以有調查人員、調查時段與天氣，沒有 external_id 與信心值。
 *
 * RB（巡修）多了回填材料與尺寸，放在另一張表：
 * 巡查單有九成是 RA，把材料欄位塞進主表等於九成的列都是空的，
 * 而且「有沒有修過」這件事會變成靠欄位是不是 null 來猜。
 */
@Entity({ name: 'maintenances' })
@Unique('uq_maintenance_case_num', ['caseNum'])
@Index('idx_maintenance_project_type', ['project', 'type'])
@Index('idx_maintenance_survey', ['surveyDate', 'surveyUser'])
@Index('idx_maintenance_admin', ['district', 'cavlge'])
export class Maintenance {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  /** 巡查單號，系統依標案與類型自動編碼 */
  @Column({ name: 'case_num', type: 'varchar', length: 30 })
  caseNum!: string;

  @ManyToOne(() => Project, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'type', type: 'varchar', length: 2 })
  type!: MaintenanceType;

  // ─── 調查 ───────────────────────────────────────────────────────

  @Column({ name: 'survey_date', type: 'date' })
  surveyDate!: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'survey_user_id' })
  surveyUser?: User;

  /** 調查時段 AM/PM；報表要分上下午統計出勤 */
  @Column({ name: 'period', type: 'varchar', length: 2, nullable: true })
  period?: string;

  @Column({ name: 'weather', type: 'varchar', length: 4, nullable: true })
  weather?: string;

  // ─── 破壞 ───────────────────────────────────────────────────────

  /** 破壞類型，沿用判讀模型的 key（Potholes、Alligator_Cracking…） */
  @Column({ name: 'dtype', type: 'varchar', length: 30, nullable: true })
  dtype?: string;

  @Column({ name: 'degree', type: 'varchar', length: 1, nullable: true })
  degree?: string;

  /**
   * 坑洞編號：同一標案內連號。
   *
   * 業主的坑洞管制表用這個編號對帳，而它只對坑洞有意義 ——
   * 破壞類型改成非坑洞時要清掉，留著會在對帳表上多出一個永遠找不到的編號。
   */
  @Column({ name: 'pothole_number', type: 'int', nullable: true })
  potholeNumber?: number;

  @Column({ name: 'dtype_length', type: 'double precision', nullable: true })
  dtypeLength?: number;

  @Column({ name: 'dtype_width', type: 'double precision', nullable: true })
  dtypeWidth?: number;

  @Column({ name: 'dtype_area', type: 'double precision', nullable: true })
  dtypeArea?: number;

  // ─── 地點 ───────────────────────────────────────────────────────

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'cavlge', type: 'varchar', length: 10, nullable: true })
  cavlge?: string;

  @Column({ name: 'address', type: 'varchar', length: 100, nullable: true })
  address?: string;

  @Index('idx_maintenance_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  geom?: { type: 'Point'; coordinates: [number, number] };

  @Column({ name: 'remark', type: 'varchar', length: 250, nullable: true })
  remark?: string;

  @OneToOne(() => MaintenanceStatus, (s) => s.maintenance)
  status?: MaintenanceStatus;

  @OneToOne(() => MaintenanceRepair, (r) => r.maintenance)
  repair?: MaintenanceRepair;

  @OneToMany(() => MaintenanceImage, (i) => i.maintenance)
  images!: MaintenanceImage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
