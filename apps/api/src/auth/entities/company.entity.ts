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
import { User } from './user.entity';
import { CompanyGrant } from './company-grant.entity';

/**
 * 公司層級。
 *
 *   1 PLATFORM      平台管理方 —— 開通廠商單位的模組與人員額度
 *   2 CONTRACTOR    廠商單位   —— 承攬標案；再開通給自己的外包單位
 *   3 SUBCONTRACTOR 外包單位   —— 實際施工，權限是廠商給的子集
 */
export const COMPANY_TIER = { PLATFORM: 1, CONTRACTOR: 2, SUBCONTRACTOR: 3 } as const;

export type CompanyTier = (typeof COMPANY_TIER)[keyof typeof COMPANY_TIER];

/**
 * 公司(多租戶邊界：所有查詢都以 company_id 收斂)。
 *
 * **三層而不是兩層**：平台開通給廠商、廠商再開通給外包。
 * 每一層只看得到自己與底下的單位 —— 廠商不知道平台這個層級存在，
 * 這不只是畫面上不顯示：查詢一律以「自己的子樹」收斂，
 * 所以就算直接打 API 也拿不到上層的資料。
 *
 * 用自關聯而不是三張表：三層的規則完全一樣（開通、停用、往下傳遞），
 * 拆三張表會讓同一段邏輯抄三遍，而且哪天要加第四層就得再抄一次。
 */
@Entity({ name: 'companies' })
@Unique('uq_company_code', ['code'])
export class Company {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'code', type: 'varchar', length: 10 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 50 })
  name!: string;

  /** 平台層沒有上層；其餘都必須有 —— 沒有上層的廠商不會有人幫它開通 */
  @ManyToOne(() => Company, (c) => c.children, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent?: Company | null;

  @OneToMany(() => Company, (c) => c.parent)
  children!: Company[];

  @Column({ name: 'tier', type: 'int', default: COMPANY_TIER.CONTRACTOR })
  tier!: CompanyTier;

  /**
   * 人員額度。
   *
   * 由上層設定 —— 開通模組卻不限人數的話，一個廠商可以無限開帳號，
   * 而每個帳號都是一份授權成本。
   */
  @Column({ name: 'user_limit', type: 'int', default: 10 })
  userLimit!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'description', type: 'varchar', length: 100, nullable: true })
  description?: string;

  @OneToMany(() => User, (u) => u.company)
  users!: User[];

  @OneToMany(() => CompanyGrant, (g) => g.company)
  grants!: CompanyGrant[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
