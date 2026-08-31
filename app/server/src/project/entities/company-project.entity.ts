import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from './project.entity';

/**
 * 公司-標案關聯。
 *
 * 為什麼不把 company_id 直接放進標案表：一個標案可能由主辦與協力廠商共同執行，
 * 而且廠商會中途換人。用關聯表的話，換廠商是「把舊的設成 inactive、新增一筆」，
 * 歷史資料仍然查得到當時是誰在做。
 *
 * `isActive` 而不是刪除：已結束的合作關係要保留，
 * 否則去年的案件會查不到當時的執行廠商。
 */
@Entity({ name: 'company_projects' })
@Unique('uq_company_project', ['company', 'project'])
@Index('idx_company_project_active', ['project', 'company', 'isActive'])
export class CompanyProject {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Project, (p) => p.companyProjects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  /** 角色：MAIN 主辦 / SUB 協力 */
  @Column({ name: 'role', type: 'varchar', length: 10, default: 'MAIN' })
  role!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
