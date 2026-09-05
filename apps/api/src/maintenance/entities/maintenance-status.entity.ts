import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Maintenance } from './maintenance.entity';
import { User } from '@entities/user.entity';

/**
 * 巡查單狀態。
 *
 * -1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工
 *
 * 與案件狀態同一套語意 —— 巡查單記的是「發現了什麼」，
 * 不是派工單那條施工流程。刪除是狀態而不是真的刪列：
 * 巡查單可能已經被派工單引用，真刪會讓派工單變成孤兒。
 */
@Entity({ name: 'maintenance_statuses' })
@Unique('uq_maintenance_status', ['maintenance'])
@Index('idx_maintenance_status_value', ['status'])
export class MaintenanceStatus {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @OneToOne(() => Maintenance, (m) => m.status, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'maintenance_id' })
  maintenance!: Maintenance;

  @Column({ name: 'status', type: 'int', default: 0 })
  status!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'upd_status_usr' })
  updStatusUsr?: User;

  @UpdateDateColumn({ name: 'upd_status_at', type: 'timestamptz', nullable: true })
  updStatusAt?: Date;
}
