import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '@entities/user.entity';

/**
 * 可被版本化的實體類型。
 *
 * 用一張表記所有類型的歷程，而不是每個實體各一張 ——
 * 稽核時要問的是「這段期間誰改了什麼」，跨實體查詢比較常見；
 * 而且版本化的邏輯只需要寫一次。
 */
export const CASE_TYPE = ['CASE_PATROL', 'MAINTENANCE', 'WORK_ORDER', 'PROJECT', 'SURVEY'] as const;
export type CaseType = (typeof CASE_TYPE)[number];

export const HISTORY_ACTION = [
  'CREATED',
  'UPDATED',
  'GEOCODED',
  'STATUS_CHANGED',
  'DISPATCHED',
  'WORKING',
  'REPORTED',
  'FINISHED',
  'ACCEPTED',
  'RETURNED',
  'IMAGE_UPLOADED',
  'IMAGE_DELETED',
  'RESTORED',
  'DELETED'
] as const;
export type HistoryAction = (typeof HISTORY_ACTION)[number];

/** 一次變更的欄位差異：欄位名 → { from, to } */
export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * 案件歷程。
 *
 * 主鍵是 (caseType, caseId, version) —— 版本號是主鍵的一部分而不是流水號，
 * 因為「第 3 版」在同一個案件內必須唯一，而這件事應該由資料庫保證，
 * 不是靠應用層小心翼翼地遞增。
 *
 * `snapshotJson` 存**當下的完整樣貌**，不只是差異：
 * 只存差異的話，要看第 30 版長什麼樣就得從第 1 版重放 29 次，
 * 中間任何一筆寫壞，後面全部跟著錯。
 *
 * 只進不出：一旦寫入就不修改也不刪除。「還原到某版本」也是寫一筆新版本，
 * 而不是把後面的刪掉 —— 能被抹掉的歷程不算歷程。
 */
@Entity({ name: 'case_histories' })
@Index('idx_history_modified_at', ['modifiedAt'])
@Index('idx_history_action', ['caseType', 'action'])
export class CaseHistory {
  @PrimaryColumn({ name: 'case_type', type: 'varchar', length: 20 })
  caseType!: CaseType;

  @PrimaryColumn({ name: 'case_id', type: 'int' })
  caseId!: number;

  @PrimaryColumn({ name: 'version', type: 'int' })
  version!: number;

  /** 這個版本的完整樣貌 */
  @Column({ name: 'snapshot_json', type: 'jsonb' })
  snapshotJson!: Record<string, unknown>;

  /** 這次動了哪些欄位；顯示「改了什麼」時不必自己比對兩個快照 */
  @Column({ name: 'changes_json', type: 'jsonb', nullable: true })
  changesJson?: FieldChanges;

  @Column({ name: 'action', type: 'varchar', length: 30, nullable: true })
  action?: HistoryAction;

  @Column({ name: 'from_state', type: 'varchar', length: 30, nullable: true })
  fromState?: string;

  @Column({ name: 'to_state', type: 'varchar', length: 30, nullable: true })
  toState?: string;

  /** 非人為操作時記錄來源：TASK / WORKER / DEVICE */
  @Column({ name: 'source', type: 'varchar', length: 10, default: 'USER' })
  source!: string;

  @Column({ name: 'note', type: 'varchar', length: 300, nullable: true })
  note?: string;

  /** 操作者的 IP 與裝置；爭議時要能追出是誰在哪裡改的 */
  @Column({ name: 'client_ip', type: 'varchar', length: 45, nullable: true })
  clientIp?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'modified_by' })
  modifiedBy?: User;

  @CreateDateColumn({ name: 'modified_at', type: 'timestamptz' })
  modifiedAt!: Date;
}
