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
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { Project } from '@/project/entities/project.entity';
import { SurveyCase } from './survey-case.entity';
import { SurveyOrderDetail } from './survey-order-detail.entity';

import { SURVEY_ORDER_STATE_DEF, keysOf, type SurveyOrderState } from '@road-patrol/shared';

export const SURVEY_ORDER_STATE = keysOf(SURVEY_ORDER_STATE_DEF);
export type { SurveyOrderState };

/**
 * 鋪面調查委託單。
 *
 * 與派工單的差別：派工是「去修」，委託是「去看」。
 * 調查通常是驗收前或爭議發生時才做，一張委託單底下有多個調查點，
 * 結果會回到路段評估去修正 PCI。
 */
@Entity({ name: 'survey_orders' })
@Unique('uq_survey_order_no', ['company', 'orderNo'])
@Index('idx_survey_order_state', ['company', 'state'])
export class SurveyOrder {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'order_no', type: 'varchar', length: 40 })
  orderNo!: string;

  @Column({ name: 'title', type: 'varchar', length: 100 })
  title!: string;

  @Column({ name: 'state', type: 'varchar', length: 12, default: 'DRAFT' })
  state!: SurveyOrderState;

  /** 委託單位；驗收爭議時要知道是誰要求調查的 */
  @Column({ name: 'requester', type: 'varchar', length: 60, nullable: true })
  requester?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'surveyor_id' })
  surveyor?: User;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string;

  @Column({ name: 'remark', type: 'varchar', length: 300, nullable: true })
  remark?: string;

  @OneToMany(() => SurveyCase, (c) => c.order)
  cases!: SurveyCase[];

  @OneToMany(() => SurveyOrderDetail, (d) => d.order)
  details!: SurveyOrderDetail[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
