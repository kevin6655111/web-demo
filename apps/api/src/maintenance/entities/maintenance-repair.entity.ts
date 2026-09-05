import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Maintenance } from './maintenance.entity';

/**
 * 巡修內容（只有 RB 有）。
 *
 * 「當場修掉了」與「看到了」是兩件事，計價也只認前者 ——
 * 所以巡修的材料與數量獨立一張表：RB 改回 RA 時整列刪掉，
 * 留在主表的話會變成一張沒修過的單上寫著用了幾包冷瀝青。
 */
@Entity({ name: 'maintenance_repairs' })
@Unique('uq_maintenance_repair', ['maintenance'])
export class MaintenanceRepair {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @OneToOne(() => Maintenance, (m) => m.repair, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'maintenance_id' })
  maintenance!: Maintenance;

  @Column({ name: 'material', type: 'varchar', length: 10, nullable: true })
  material?: string;

  @Column({ name: 'refill_length', type: 'double precision', nullable: true })
  refillLength?: number;

  @Column({ name: 'refill_width', type: 'double precision', nullable: true })
  refillWidth?: number;

  /** 用料數量（包／立方）；計價依材料別各有單位 */
  @Column({ name: 'quantity', type: 'int', nullable: true })
  quantity?: number;

  @UpdateDateColumn({ name: 'repair_date', type: 'timestamptz' })
  repairDate!: Date;
}
