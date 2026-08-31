import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Project } from './project.entity';
import { Section } from './section.entity';
import { SectionArea } from './section-area.entity';

/**
 * 標案-工務段關聯。
 *
 * 一個標案可能跨多個工務段（例如全市巡查），
 * 一個工務段也會同時執行多個標案。轄區則掛在這個關聯之下 ——
 * 因為「甲工務段在 A 標案負責西屯區、在 B 標案負責北屯區」是真實存在的情況。
 */
@Entity({ name: 'project_sections' })
@Unique('uq_project_section', ['project', 'section'])
@Index('idx_project_section_active', ['project', 'section', 'isActive'])
export class ProjectSection {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Project, (p) => p.projectSections, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @ManyToOne(() => Section, (s) => s.projectSections, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section?: Section;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => SectionArea, (sa) => sa.projectSection)
  sectionAreas!: SectionArea[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
