import { Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Feature } from './feature.entity';

/**
 * 導覽模組。
 *
 * 側邊欄不是寫死在前端，而是從這兩張表長出來的：
 *   Module  → 側邊欄的一層(圖台管理、案件管理…)
 *   Feature → 該模組底下的子功能(車隊管理、軌跡查詢…)
 *
 * 這樣做的理由是「不同站台開的功能不一樣」——
 * 有些客戶沒買鋪面調查、有些沒有二篩系統。
 * 寫死在前端的話，每個站台就得各自維護一份 build。
 */
@Entity({ name: 'modules' })
@Unique('uq_module_key', ['key'])
export class ModuleNav {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'key', type: 'varchar', length: 30 })
  key!: string;

  @Column({ name: 'name', type: 'varchar', length: 30 })
  name!: string;

  /** react-icons 的圖示名稱；前端用名稱查表，不把元件名寫進資料庫 */
  @Column({ name: 'icon', type: 'varchar', length: 60, nullable: true })
  icon?: string;

  @Column({ name: 'path', type: 'varchar', length: 100, nullable: true })
  path?: string;

  /** 進入模組時預設開啟的子功能 */
  @Column({ name: 'default_sub_nav', type: 'varchar', length: 30, nullable: true })
  defaultSubNav?: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @OneToMany(() => Feature, (f) => f.module)
  features!: Feature[];
}
