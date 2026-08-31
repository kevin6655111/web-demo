import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { CompanyProject } from './company-project.entity';
import { ProjectVehicle } from './project-vehicle.entity';
import { ProjectSection } from './project-section.entity';

/** 標案狀態 */
export const PROJECT_STATE = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type ProjectState = (typeof PROJECT_STATE)[number];

/**
 * 標案。
 *
 * 巡查系統的資料幾乎都掛在標案底下：同一條路在不同年度屬於不同標案，
 * 統計、報表、驗收、請款也都以標案為單位。
 *
 * 標案號(prjId)與標案編號(prjNo)分開：前者是系統內部用的短代碼(進案件編號)，
 * 後者是招標文件上的正式編號 —— 兩者格式不同，也不是每個案子都有後者。
 *
 * 標案不直接掛公司，而是透過 company_project 關聯 ——
 * 一個標案可能由主辦與協力廠商共同執行，而權限要能分別控制。
 */
@Entity({ name: 'projects' })
@Unique('uq_project_prj_id', ['prjId'])
@Index('idx_project_date_range', ['startDate', 'endDate'])
@Index('idx_project_state', ['state'])
export class Project {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** 標案號：進案件編號的短代碼 */
  @Column({ name: 'prj_id', type: 'varchar', length: 10 })
  prjId!: string;

  /** 招標文件上的正式編號 */
  @Column({ name: 'prj_no', type: 'varchar', length: 30, nullable: true })
  prjNo?: string;

  @Column({ name: 'prj_name', type: 'varchar', length: 50 })
  prjName!: string;

  @Column({ name: 'prj_main', type: 'varchar', length: 100 })
  prjMain!: string;

  @Column({ name: 'prj_sub', type: 'varchar', length: 50, nullable: true })
  prjSub?: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  /** 業主 */
  @Column({ name: 'proprietor', type: 'varchar', length: 30 })
  proprietor!: string;

  /**
   * 業主等級：1 中央 / 2 直轄市 / 3 縣市 / 4 鄉鎮。
   * 影響報表格式與上傳規則 —— 中央的案子要另外報部裡的系統。
   */
  @Column({ name: 'proprietor_level', type: 'int', default: 3 })
  proprietorLevel!: number;

  @Column({ name: 'state', type: 'varchar', length: 10, default: 'DRAFT' })
  state!: ProjectState;

  @Column({ name: 'budget', type: 'numeric', precision: 14, scale: 0, default: 0 })
  budget!: string;

  @Column({ name: 'road_km', type: 'numeric', precision: 8, scale: 2, default: 0 })
  roadKm!: string;

  @OneToMany(() => CompanyProject, (cp) => cp.project)
  companyProjects!: CompanyProject[];

  @OneToMany(() => ProjectVehicle, (pv) => pv.project)
  projectVehicles!: ProjectVehicle[];

  @OneToMany(() => ProjectSection, (ps) => ps.project)
  projectSections!: ProjectSection[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
