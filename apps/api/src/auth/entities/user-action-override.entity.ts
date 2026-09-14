import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { User } from './user.entity';

/**
 * 個人授權覆蓋。
 *
 * 角色是「這一類人平常能做什麼」，覆蓋是「這一個人例外」：
 * 代理主管期間多開一個驗收權限、或某位巡查員被暫時收回派工權。
 * 為了一個人開一個新角色，角色清單很快就會長成人名清單。
 *
 * `is_granted = true` 額外開啟、`false` 明確撤銷。
 * 開啟仍受公司開通清單限制 —— 覆蓋開不出上層沒開通的功能。
 * `reason` 必填的理由：稽核時要知道「為什麼這個人跟同角色的人不一樣」。
 */
@Entity({ name: 'user_action_overrides' })
@Unique('uq_user_action_override', ['user', 'actionKey'])
export class UserActionOverride {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => User, (u) => u.actionOverrides, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'action_key', type: 'varchar', length: 40 })
  actionKey!: string;

  @Column({ name: 'is_granted', type: 'boolean' })
  isGranted!: boolean;

  @Column({ name: 'reason', type: 'varchar', length: 200, nullable: true })
  reason?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'granted_by' })
  grantedBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
