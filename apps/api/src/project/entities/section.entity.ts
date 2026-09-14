import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { ProjectSection } from './project-section.entity';

/**
 * 工務段。
 *
 * 養護單位的實際管理單位 —— 派工要按工務段分派，
 * 報表也要按工務段出。它屬於公司而不是標案：同一個工務段會接多個標案。
 */
@Entity({ name: 'sections' })
@Unique('uq_section_company_key', ['company', 'key'])
export class Section {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'key', type: 'varchar', length: 10 })
  key!: string;

  @Column({ name: 'name', type: 'varchar', length: 50 })
  name!: string;

  @OneToMany(() => ProjectSection, (ps) => ps.section)
  projectSections!: ProjectSection[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
