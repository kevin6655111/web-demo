import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Company } from './company.entity';
import { Role } from './role.entity';

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
