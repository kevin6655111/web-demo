import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { ProjectSection } from './project-section.entity';
import { Area } from './area.entity';

/**
 * 工務段轄區。
 *
 * 掛在「標案-工務段」之下而不是工務段之下，因為轄區是隨標案劃分的 ——
 * 同一個工務段在不同標案負責的行政區可以不同。
 *
 * 這張表決定案件自動派給哪個工務段：案件的行政區對到轄區，就找得到負責單位。
 */
@Entity({ name: 'section_areas' })
@Unique('uq_section_area', ['projectSection', 'area'])
@Index('idx_section_area_active', ['projectSection', 'area', 'isActive'])
export class SectionArea {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => ProjectSection, (ps) => ps.sectionAreas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_section_id' })
  projectSection!: ProjectSection;

  @ManyToOne(() => Area, (a) => a.sectionAreas, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'area_id' })
  area?: Area;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
