import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { Project } from '@/project/entities/project.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { WorkOrderStatus } from './work-order-status.entity';
import { WorkOrderImage } from './work-order-image.entity';
import { WorkOrderImprovement } from './work-order-improvement.entity';

/** 派工單類型：PA 刨除加封 / PB 路基改善 / PC AI 車巡 / PD APP 巡查 */
export const WORK_ORDER_TYPE = ['PA', 'PB', 'PC', 'PD'] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPE)[number];

/**
 * 派工單。
 *
 * 欄位分成四組，對應四個時間點填寫：
 *   派工時   類型、標案、地點、施工人員、期限
 *   開工時   施工起訖日、材料與尺寸
 *   完工時   照片（另一張表）
 *   驗收時   狀態（另一張表）
 *
 * 起訖點分開存座標與地址：刨除加封是「一段路」而不是一個點，
 * 只存一個座標的話，驗收時無法確認施作範圍是否符合派工。
 */
@Entity({ name: 'work_orders' })
@Unique('uq_work_order_case_num', ['caseNum'])
@Index('idx_work_order_project', ['project'])
@Index('idx_work_order_type', ['type'])
@Index('idx_work_order_dispatch', ['dispatchDate', 'workerUser'])
@Index('idx_work_order_admin', ['district', 'cavlge'])
export class WorkOrder {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  /** 派工單編號，系統依標案與類型自動編碼 */
  @Column({ name: 'case_num', type: 'varchar', length: 30 })
  caseNum!: string;

  @ManyToOne(() => Project, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'type', type: 'varchar', length: 2 })
  type!: WorkOrderType;

  // ─── 日期 ───────────────────────────────────────────────────────

  @Column({ name: 'dispatch_date', type: 'date' })
  dispatchDate!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string;

  @Column({ name: 'work_start_date', type: 'date', nullable: true })
  workStartDate?: string;

  @Column({ name: 'work_end_date', type: 'date', nullable: true })
  workEndDate?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'worker_user_id' })
  workerUser?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'dispatcher_id' })
  dispatcher?: User;

  // ─── 地點 ───────────────────────────────────────────────────────

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10 })
  district!: string;

  @Column({ name: 'cavlge', type: 'varchar', length: 10, nullable: true })
  cavlge?: string;

  @Column({ name: 'address', type: 'varchar', length: 100 })
  address!: string;

  @Column({ name: 'start_addr', type: 'varchar', length: 100, nullable: true })
  startAddr?: string;

  @Column({ name: 'end_addr', type: 'varchar', length: 100, nullable: true })
  endAddr?: string;

  @Index('idx_work_order_start_geom', { spatial: true })
  @Column({ name: 'start_geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  startGeom?: { type: 'Point'; coordinates: [number, number] };

  @Index('idx_work_order_end_geom', { spatial: true })
  @Column({ name: 'end_geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  endGeom?: { type: 'Point'; coordinates: [number, number] };

  // ─── 施工尺寸與材料 ──────────────────────────────────────────────

  @Column({ name: 'material', type: 'varchar', length: 10, nullable: true })
  material?: string;

  /** 材料粒徑 mm；影響單價，計價時要用 */
  @Column({ name: 'material_size', type: 'double precision', nullable: true })
  materialSize?: number;

  @Column({ name: 'work_length', type: 'double precision', nullable: true })
  workLength?: number;

  @Column({ name: 'work_width', type: 'double precision', nullable: true })
  workWidth?: number;

  /** 刨除深度與鋪築深度分開：兩者可以不同，而且是兩個計價項目 */
  @Column({ name: 'work_depth_milling', type: 'double precision', nullable: true })
  workDepthMilling?: number;

  @Column({ name: 'work_depth_paving', type: 'double precision', nullable: true })
  workDepthPaving?: number;

  @Column({ name: 'remark', type: 'varchar', length: 250, nullable: true })
  remark?: string;

  // ─── 來源案件 ───────────────────────────────────────────────────

  /** PC 類型的來源；一個案件同時只能有一張有效派工單 */
  @OneToOne(() => PatrolCase, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'case_patrol_id' })
  casePatrol?: PatrolCase;

  @OneToOne(() => WorkOrderStatus, (s) => s.workOrder)
  status?: WorkOrderStatus;

  @OneToMany(() => WorkOrderImage, (i) => i.workOrder)
  images!: WorkOrderImage[];

  @OneToOne(() => WorkOrderImprovement, (i) => i.workOrder)
  improvement?: WorkOrderImprovement;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
