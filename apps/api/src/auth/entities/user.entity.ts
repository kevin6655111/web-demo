import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from './company.entity';
import { Role } from './role.entity';
import { Department } from './department.entity';
import { UserActionOverride } from './user-action-override.entity';

/** 使用者 */
@Entity({ name: 'users' })
@Unique('uq_user_company_account', ['company', 'account'])
@Index('idx_user_company_id', ['company'])
export class User {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, (c) => c.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Role, (r) => r.users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id' })
  role?: Role;

  @Column({ name: 'account', type: 'varchar', length: 30 })
  account!: string;

  /** bcrypt hash，永不回傳給前端 */
  @Column({ name: 'password', type: 'varchar', length: 100, select: false })
  password!: string;

  @Column({ name: 'name', type: 'varchar', length: 30 })
  name!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  // ─── 人員資料 ───────────────────────────────────────────────────

  @ManyToOne(() => Department, (d) => d.users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department?: Department | null;

  /** 主管：請假代理與逾期催辦要找得到人 */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'manager_id' })
  manager?: User | null;

  /** 員工編號，系統自動產生；報表與薪資表用它而不是帳號 */
  @Column({ name: 'employee_no', type: 'varchar', length: 20, nullable: true })
  employeeNo?: string;

  @Column({ name: 'english_name', type: 'varchar', length: 60, nullable: true })
  englishName?: string;

  @Column({ name: 'email', type: 'varchar', length: 120, nullable: true })
  email?: string;

  @Column({ name: 'job_title', type: 'varchar', length: 40, nullable: true })
  jobTitle?: string;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate?: string;

  /** 離職日；到了這一天帳號就登不進來，不必等人記得去停用 */
  @Column({ name: 'leave_date', type: 'date', nullable: true })
  leaveDate?: string;

  /** 登入後預設進入的模組 */
  @Column({ name: 'home_sys', type: 'varchar', length: 20, nullable: true })
  homeSys?: string;

  @Column({ name: 'avatar_path', type: 'varchar', length: 255, nullable: true })
  avatarPath?: string;

  /** 帳號有效期限；外包或臨時帳號用 */
  @Column({ name: 'expire_at', type: 'timestamptz', nullable: true })
  expireAt?: Date;

  // ─── 密碼政策 ───────────────────────────────────────────────────

  /** 上次改密碼的時間：24 小時冷卻與定期更換都看它 */
  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt?: Date;

  /** 首次登入或管理者重設密碼後為 true：下一次登入必須改密碼 */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @OneToMany(() => UserActionOverride, (o) => o.user)
  actionOverrides!: UserActionOverride[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
