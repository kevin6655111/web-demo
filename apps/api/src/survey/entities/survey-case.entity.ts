import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { SurveyOrder } from './survey-order.entity';
import { SurveyOrderDetail } from './survey-order-detail.entity';

/** 調查方法：不同方法的可信度不同，報告要標出來 */
import { SURVEY_METHOD_DEF, keysOf, type SurveyMethod } from '@road-patrol/shared';

export const SURVEY_METHOD = keysOf(SURVEY_METHOD_DEF);
export type { SurveyMethod };

export const SURVEY_CASE_STATE = ['PENDING', 'DONE', 'REJECTED'] as const;
export type SurveyCaseState = (typeof SURVEY_CASE_STATE)[number];

/** 誰建的：網頁排點、App 現場收案、或由車機批次匯入 */
export const SURVEY_CASE_SOURCE = ['WEB', 'APP', 'DEVICE'] as const;
export type SurveyCaseSource = (typeof SURVEY_CASE_SOURCE)[number];

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

  /** 對應的委託明細；沒有對應時是臨時加測的點 */
  @ManyToOne(() => SurveyOrderDetail, (d) => d.cases, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'detail_id' })
  detail?: SurveyOrderDetail | null;

  /** 案件編號；報表與公文用這個而不是 id */
  @Column({ name: 'case_num', type: 'varchar', length: 30, nullable: true })
  caseNum?: string;

  /** App 上游的識別碼；重送時值不變，是去重的依據。網頁排點沒有 */
  @Column({ name: 'external_id', type: 'varchar', length: 60, nullable: true })
  externalId?: string;

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

  // ─── 現場欄位(App 填的) ─────────────────────────────────────────

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  /** 第幾車道；同一個位置不同車道的鋪面狀況可能差很多 */
  @Column({ name: 'lane', type: 'int', nullable: true })
  lane?: number;

  @Column({ name: 'station_k', type: 'int', nullable: true })
  stationK?: number;

  @Column({ name: 'station_m', type: 'int', nullable: true })
  stationM?: number;

  /** 天氣：雨後的路面狀況與晴天量到的不同，報表要標註 */
  @Column({ name: 'weather', type: 'varchar', length: 10, nullable: true })
  weather?: string;

  @Column({ name: 'dtype', type: 'varchar', length: 30, nullable: true })
  dtype?: string;

  @Column({ name: 'degree', type: 'varchar', length: 1, nullable: true })
  degree?: string;

  @Column({ name: 'dtype_length', type: 'double precision', nullable: true })
  dtypeLength?: number;

  @Column({ name: 'dtype_width', type: 'double precision', nullable: true })
  dtypeWidth?: number;

  @Column({ name: 'dtype_area', type: 'double precision', nullable: true })
  dtypeArea?: number;

  @Column({ name: 'dtype_qty', type: 'int', nullable: true })
  dtypeQty?: number;

  @Column({ name: 'source', type: 'varchar', length: 10, default: 'WEB' })
  source!: SurveyCaseSource;

  /**
   * 軟刪除。
   *
   * 業主會要一張「已刪除案件表」—— 硬刪除之後那張報表永遠是空的，
   * 而「為什麼這個樣點不見了」在驗收時一定會被問。
   */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deleted_by' })
  deletedBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
