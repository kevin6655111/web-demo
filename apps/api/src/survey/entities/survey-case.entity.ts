import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { SurveyOrder } from './survey-order.entity';

/** 調查方法：不同方法的可信度不同，報告要標出來 */
import { SURVEY_METHOD_DEF, keysOf, type SurveyMethod } from '@road-patrol/shared';

export const SURVEY_METHOD = keysOf(SURVEY_METHOD_DEF);
export type { SurveyMethod };

export const SURVEY_CASE_STATE = ['PENDING', 'DONE', 'REJECTED'] as const;
export type SurveyCaseState = (typeof SURVEY_CASE_STATE)[number];

/** 調查案件：一個實際去看的點 */
@Entity({ name: 'survey_cases' })
@Index('idx_survey_case_order', ['order'])
@Index('idx_survey_case_state', ['company', 'state'])
export class SurveyCase {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => SurveyOrder, (o) => o.cases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: SurveyOrder;

  /** 對應路段；調查結果會回寫到它的 PCI */
  @ManyToOne(() => RoadSegment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'segment_id' })
  segment?: RoadSegment;

  @Index('idx_survey_case_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  geom!: { type: 'Point'; coordinates: [number, number] };

  @Column({ name: 'road_name', type: 'varchar', length: 100, nullable: true })
  roadName?: string;

  @Column({ name: 'method', type: 'varchar', length: 12, default: 'VISUAL' })
  method!: SurveyMethod;

  @Column({ name: 'state', type: 'varchar', length: 10, default: 'PENDING' })
  state!: SurveyCaseState;

  /** 鋪面厚度(公分)；鑽心取樣才有 */
  @Column({ name: 'thickness_cm', type: 'numeric', precision: 6, scale: 2, nullable: true })
  thicknessCm?: string;

  @Column({ name: 'pci', type: 'numeric', precision: 5, scale: 2, nullable: true })
  pci?: string;

  @Column({ name: 'iri', type: 'numeric', precision: 5, scale: 2, nullable: true })
  iri?: string;

  @Column({ name: 'photo_key', type: 'varchar', length: 200, nullable: true })
  photoKey?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'surveyor_id' })
  surveyor?: User;

  @Column({ name: 'surveyed_at', type: 'timestamptz', nullable: true })
  surveyedAt?: Date;

  @Column({ name: 'finding', type: 'varchar', length: 300, nullable: true })
  finding?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
