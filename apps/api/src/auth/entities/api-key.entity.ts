import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from './company.entity';
import { User } from './user.entity';

/**
 * API Key：給車機、App 後端與對接系統用的憑證。
 *
 * 不讓機器拿人的帳號登入，理由有三：
 *   - 人離職要停帳號，但車機還在跑
 *   - 金鑰有自己的權限範圍(`scopes`)，車機只該能上傳，不該能刪案件
 *   - 稽核上要分得出「這筆是哪台設備送的」
 *
 * 只存 SHA-256 雜湊；明文只在核發那一刻回傳一次。
 * `prefix` 是明文前幾碼，讓管理者對得出「這是哪一把」而不必看到整把。
 */
@Entity({ name: 'api_keys' })
@Unique('uq_api_key_hash', ['keyHash'])
@Index('idx_api_key_company', ['company', 'isActive'])
export class ApiKey {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'name', type: 'varchar', length: 60 })
  name!: string;

  @Column({ name: 'prefix', type: 'varchar', length: 12 })
  prefix!: string;

  @Column({ name: 'key_hash', type: 'varchar', length: 64 })
  keyHash!: string;

  /** 允許的動作鍵；驗證時直接當作這把金鑰的 actions */
  @Column({ name: 'scopes', type: 'text', array: true, default: () => "'{}'" })
  scopes!: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
