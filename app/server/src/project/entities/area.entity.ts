import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { SectionArea } from './section-area.entity';

/**
 * 行政區。
 *
 * 縣市 + 鄉鎮市區的正規化表 —— 案件地址、派工地點、工務段轄區都指向它。
 * 用表而不是字串，因為「西屯區」在不同資料來源會有不同寫法
 * （西屯、西屯區、臺中市西屯區），統計時會被切成三個。
 */
@Entity({ name: 'areas' })
@Unique('uq_area_county_district', ['county', 'district'])
export class Area {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'county', type: 'varchar', length: 10 })
  county!: string;

  @Column({ name: 'district', type: 'varchar', length: 10 })
  district!: string;

  @OneToMany(() => SectionArea, (sa) => sa.area)
  sectionAreas!: SectionArea[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
