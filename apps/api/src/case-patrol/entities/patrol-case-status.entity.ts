import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { PatrolCase } from './patrol-case.entity';
import { User } from '@entities/user.entity';

/**
 * 案件狀態。
 *
 * 三組狀態是三個獨立的判斷，由不同的人在不同時間做 ——
 * 合成一個欄位的話，「已派工但二篩還沒過」這種真實存在的狀態就表達不出來：
 *
 *   status      二篩結果：這是不是真的破壞（0 未篩 / 1 通過 / 2 待審 / 3 刪除 / 4 誤判）
 *   edited      有沒有被人工改過（稽核要看的是「誰改了什麼」，不是「現在是什麼」）
 *   needRepair  要不要修（-1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工）
 *
 * 每一組都記錄「誰改的、什麼時候」，而且使用者與管理者分開記 ——
 * 覆核制度下，管理者改過的紀錄不該被使用者的操作蓋掉。
 */
@Entity({ name: 'patrol_case_statuses' })
@Unique('uq_case_status', ['patrolCase'])
@Index('idx_case_status_value', ['patrolCase', 'status'])
@Index('idx_case_status_need_repair', ['patrolCase', 'needRepair'])
@Index('idx_case_status_edited', ['patrolCase', 'edited'])
export class PatrolCaseStatus {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @OneToOne(() => PatrolCase, (c) => c.status, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  patrolCase!: PatrolCase;

  // ─── 二篩狀態 ───────────────────────────────────────────────────

  @Column({ name: 'status', type: 'int', default: 0 })
  status!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'upd_status_usr' })
  updStatusUsr?: User;

  @Column({ name: 'upd_status_usr_at', type: 'timestamptz', nullable: true })
  updStatusUsrAt?: Date;

  /** 管理者覆核；與使用者分開記，覆核紀錄不被後續操作蓋掉 */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'upd_status_adm' })
  updStatusAdm?: User;

  @Column({ name: 'upd_status_adm_at', type: 'timestamptz', nullable: true })
  updStatusAdmAt?: Date;

  // ─── 編輯狀態 ───────────────────────────────────────────────────

  @Column({ name: 'edited', type: 'int', default: 0 })
  edited!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'upd_edited_usr' })
  updEditedUsr?: User;

  @Column({ name: 'upd_edited_at', type: 'timestamptz', nullable: true })
  updEditedAt?: Date;

  // ─── 需修復狀態 ─────────────────────────────────────────────────

  @Column({ name: 'need_repair', type: 'int', default: 0 })
  needRepair!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'upd_need_repair_usr' })
  updNeedRepairUsr?: User;

  @Column({ name: 'upd_need_repair_at', type: 'timestamptz', nullable: true })
  updNeedRepairAt?: Date;
}
