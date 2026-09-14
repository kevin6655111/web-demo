import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from './company.entity';
import { User } from './user.entity';

/**
 * 部門。
 *
 * 人員管理的分組單位：派工時「派給第一工務段的人」、報表上「各部門的巡查量」，
 * 都要靠這一層。用自關聯做上下級，因為工務段底下還會分班。
 */
@Entity({ name: 'departments' })
@Unique('uq_department_company_key', ['company', 'key'])
export class Department {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Department, (d) => d.children, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_id' })
  parent?: Department | null;

  @OneToMany(() => Department, (d) => d.parent)
  children!: Department[];

  @Column({ name: 'key', type: 'varchar', length: 20 })
  key!: string;

  @Column({ name: 'name', type: 'varchar', length: 50 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => User, (u) => u.department)
  users!: User[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
