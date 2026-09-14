import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';

/**
 * 巡查點覆蓋率的每日快照。
 *
 * 落地而不是每次即時算：覆蓋率要掃整天的軌跡點與所有巡查點做空間比對，
 * 一次幾秒鐘 —— 而它是報表與看板每次開啟都要的數字。
 *
 * 由排程每小時重算當天、每天結算前一天。重算是覆寫而不是累加，
 * 所以中途補跑不會讓數字翻倍。
 */
@Entity({ name: 'patrol_point_stats' })
@Unique('uq_point_stat', ['company', 'statDate', 'project', 'district'])
@Index('idx_point_stat_date', ['company', 'statDate'])
export class PatrolPointStat {
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

  @Column({ name: 'required_points', type: 'int', default: 0 })
  requiredPoints!: number;

  @Column({ name: 'covered_points', type: 'int', default: 0 })
  coveredPoints!: number;

  @Column({ name: 'coverage_rate', type: 'numeric', precision: 5, scale: 2, default: 0 })
  coverageRate!: string;

  /** 當天該範圍的軌跡點數；覆蓋率是 0 時要分得出「沒出車」與「出車但沒到點」 */
  @Column({ name: 'track_points', type: 'int', default: 0 })
  trackPoints!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
