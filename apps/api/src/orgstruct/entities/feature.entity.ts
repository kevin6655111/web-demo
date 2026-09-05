import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ModuleNav } from './module.entity';

/** 子功能：側邊欄的第二層，也是權限的掛載點 */
@Entity({ name: 'features' })
@Unique('uq_feature_key', ['key'])
export class Feature {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => ModuleNav, (m) => m.features, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module!: ModuleNav;

  @Column({ name: 'key', type: 'varchar', length: 30 })
  key!: string;

  @Column({ name: 'name', type: 'varchar', length: 30 })
  name!: string;

  @Column({ name: 'icon', type: 'varchar', length: 60, nullable: true })
  icon?: string;

  /** 前端元件名；由前端的對照表決定實際載入哪一支，資料庫不存路徑 */
  @Column({ name: 'component', type: 'varchar', length: 60, nullable: true })
  component?: string;

  @Column({ name: 'path', type: 'varchar', length: 100, nullable: true })
  path?: string;

  /**
   * 使用這個功能所需的權限。
   * 側邊欄依此過濾 —— 看得到卻按了就 403，是最讓人困惑的介面。
   */
  @Column({ name: 'required_action', type: 'varchar', length: 40, nullable: true })
  requiredAction?: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}
