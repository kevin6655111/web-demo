import { Column, Entity, Index, JoinColumn, OneToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { PatrolCase } from './patrol-case.entity';

/**
 * 案件地址。
 *
 * 由逆地理編碼非同步寫入，所以與主表分開 ——
 * 案件建立當下沒有地址，是正常狀態而不是資料不完整。
 *
 * 分成縣市／行政區／里／鄰／路／門牌而不是一個字串：
 * 報表要按行政區分組、派工要按里別分派，字串切不出這些。
 */
@Entity({ name: 'patrol_case_addresses' })
@Unique('uq_case_address', ['patrolCase'])
@Index('idx_case_addr_admin', ['county', 'district', 'cavlge'])
@Index('idx_case_addr_road', ['road'])
export class PatrolCaseAddress {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @OneToOne(() => PatrolCase, (c) => c.address, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  patrolCase!: PatrolCase;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'cavlge', type: 'varchar', length: 10, nullable: true })
  cavlge?: string;

  @Column({ name: 'neighbor', type: 'varchar', length: 10, nullable: true })
  neighbor?: string;

  @Column({ name: 'road', type: 'varchar', length: 100, nullable: true })
  road?: string;

  @Column({ name: 'house_number', type: 'varchar', length: 100, nullable: true })
  houseNumber?: string;

  @Column({ name: 'address', type: 'varchar', length: 150, nullable: true })
  address?: string;

  /** 逆地理編碼回傳的原始字串；解析錯誤時要能追回來源 */
  @Column({ name: 'o_address', type: 'varchar', length: 200, nullable: true })
  oAddress?: string;
}
