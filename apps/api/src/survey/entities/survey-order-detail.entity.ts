import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { SurveyOrder } from './survey-order.entity';
import { SurveyCase } from './survey-case.entity';

import { SURVEY_DIRECTION_DEF, keysOf, type KeyDef } from '@road-patrol/shared';

export const SURVEY_DIRECTION = keysOf(SURVEY_DIRECTION_DEF as readonly KeyDef[]);
export type SurveyDirection = (typeof SURVEY_DIRECTION_DEF)[number]['key'];

/**
 * 委託單明細：業主指定的一段路。
 *
 * 一張委託單通常不是「去看某一個點」，而是「這五條路各取三個樣」。
 * 沒有這一層的話，「這張委託單做完了沒有」只能靠人去數點位 ——
 * 而漏做一個樣點在驗收時才會被發現。
 *
 * 樁號(K+M)是公路的里程座標：`3K+250` 表示起點算起 3 公里又 250 公尺。
 * 存成兩個整數而不是字串，因為報表要依樁號排序。
 */
@Entity({ name: 'survey_order_details' })
@Unique('uq_survey_detail_seq', ['order', 'seq'])
@Index('idx_survey_detail_order', ['order'])
export class SurveyOrderDetail {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => SurveyOrder, (o) => o.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: SurveyOrder;

  /** 明細序號；報表上的「第幾項」 */
  @Column({ name: 'seq', type: 'int', default: 1 })
  seq!: number;

  @Column({ name: 'road', type: 'varchar', length: 100 })
  road!: string;

  @Column({ name: 'road_start', type: 'varchar', length: 60, nullable: true })
  roadStart?: string;

  @Column({ name: 'road_end', type: 'varchar', length: 60, nullable: true })
  roadEnd?: string;

  /** 樁號公里數 */
  @Column({ name: 'station_k', type: 'int', nullable: true })
  stationK?: number;

  /** 樁號公尺數 */
  @Column({ name: 'station_m', type: 'int', nullable: true })
  stationM?: number;

  @Column({ name: 'direction', type: 'varchar', length: 10, default: 'BOTH' })
  direction!: SurveyDirection;

  @Column({ name: 'lane_count', type: 'int', default: 2 })
  laneCount!: number;

  /** 應取樣數；與實際完成的調查點數比對就是進度 */
  @Column({ name: 'sample_count', type: 'int', default: 1 })
  sampleCount!: number;

  @Column({ name: 'road_length_m', type: 'numeric', precision: 10, scale: 2, nullable: true })
  roadLengthM?: string;

  @Column({ name: 'road_width_m', type: 'numeric', precision: 6, scale: 2, nullable: true })
  roadWidthM?: string;

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @OneToMany(() => SurveyCase, (c) => c.detail)
  cases!: SurveyCase[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
