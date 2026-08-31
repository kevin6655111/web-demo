import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';

/** 養護等級：由 PCI 推導，決定要不要排入年度刨鋪 */
export const MAINTAIN_LEVEL = ['GOOD', 'FAIR', 'POOR', 'CRITICAL'] as const;
export type MaintainLevel = (typeof MAINTAIN_LEVEL)[number];

/**
 * 路段評估。
 *
 * 案件是「點」，路段是「線」—— 兩者要分開存。
 * 決策的單位是路段：不會為了一個坑洞刨鋪整條路，
 * 但一條路上密集出現坑洞就該整段處理。這張表就是那個判斷的依據。
 */
@Entity({ name: 'road_segments' })
@Unique('uq_segment_code', ['company', 'code'])
@Index('idx_segment_company_level', ['company', 'maintainLevel'])
export class RoadSegment {
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

  @Column({ name: 'road_name', type: 'varchar', length: 60 })
  roadName!: string;

  @Column({ name: 'section', type: 'varchar', length: 40, nullable: true })
  section?: string;

  @Column({ name: 'district', type: 'varchar', length: 30, nullable: true })
  district?: string;

  /** 路段幾何；LineString 而非 Point —— 評估的對象是一段路 */
  @Index('idx_segment_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'LineString', srid: 4326 })
  geom!: { type: 'LineString'; coordinates: [number, number][] };

  @Column({ name: 'length_m', type: 'numeric', precision: 10, scale: 2, default: 0 })
  lengthM!: string;

  @Column({ name: 'lane_count', type: 'int', default: 2 })
  laneCount!: number;

  /** 鋪面狀況指數 0–100，越高越好 */
  @Column({ name: 'pci', type: 'numeric', precision: 5, scale: 2, default: 100 })
  pci!: string;

  /** 國際糙度指數 m/km，越低越平順 */
  @Column({ name: 'iri', type: 'numeric', precision: 5, scale: 2, nullable: true })
  iri?: string;

  @Column({ name: 'maintain_level', type: 'varchar', length: 10, default: 'GOOD' })
  maintainLevel!: MaintainLevel;

  @Column({ name: 'case_count', type: 'int', default: 0 })
  caseCount!: number;

  @Column({ name: 'last_eval_at', type: 'timestamptz', nullable: true })
  lastEvalAt?: Date;

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
