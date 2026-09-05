import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from './company.entity';
import { User } from './user.entity';

/**
 * 公司被開通的權限。
 *
 * 一列一個動作鍵（`CASE.READ`、`WORK_ORDER.CREATE`…）。
 *
 * **這是權限的上限，不是使用者的權限**：使用者實際能做什麼，
 * 是「角色給的動作」與「公司被開通的動作」取交集。
 * 少了這一層，廠商自己建一個全權限角色就繞過了開通機制。
 *
 * **只能由上層開通**：`granted_by_company_id` 記錄是誰開的，
 * 而上層自己沒有的動作開不出去 —— 授權不會憑空長出來。
 *
 * 停用而不刪除：合約中止後要查得到「當初開通過什麼」。
 */
@Entity({ name: 'company_grants' })
@Unique('uq_company_grant', ['company', 'actionKey'])
export class CompanyGrant {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, (c) => c.grants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'action_key', type: 'varchar', length: 40 })
  actionKey!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** 開通來源；平台自己的那份沒有來源 */
  @ManyToOne(() => Company, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'granted_by_company_id' })
  grantedByCompany?: Company | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'granted_by' })
  grantedBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
