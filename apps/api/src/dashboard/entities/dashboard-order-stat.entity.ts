import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';

/**
 * 派工的每日結算。
 *
 * 與巡查結算分成兩張表：維度相同但欄位完全不同 ——
 * 合併的話會得到一張半數欄位永遠是 NULL 的表，而且每次新增一種統計
 * 都要在另一半加欄位。
 *
 * 日期指的是**派工日**而不是完工日：業主問的是「這批派出去的單做完了沒有」，
 * 所以同一天派出去的單，狀態會隨著時間變動 —— 這張表每天重算，不是只寫一次。
 */
@Entity({ name: 'dashboard_order_stats' })
@Unique('uq_dashboard_order_stat', ['company', 'statDate', 'project', 'district'])
@Index('idx_dashboard_order_stat_date', ['company', 'statDate'])
export class DashboardOrderStat {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'stat_date', type: 'date' })
  statDate!: string;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'dispatched', type: 'int', default: 0 })
  dispatched!: number;

  @Column({ name: 'in_progress', type: 'int', default: 0 })
  inProgress!: number;

  @Column({ name: 'reported', type: 'int', default: 0 })
  reported!: number;

  @Column({ name: 'done', type: 'int', default: 0 })
  done!: number;

  @Column({ name: 'overdue', type: 'int', default: 0 })
  overdue!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
