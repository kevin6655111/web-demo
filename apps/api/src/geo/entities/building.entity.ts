import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 建物用途。
 *
 * 決定施工時段與交維方式：住宅區不能夜間施工、學校要避開上下學、
 * 醫院旁邊不能封死出入口。這是分類而不是備註，因為排程要依它篩。
 */
export const BUILDING_USAGE = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'SCHOOL', 'HOSPITAL', 'PUBLIC'] as const;
export type BuildingUsage = (typeof BUILDING_USAGE)[number];

/**
 * 建物量體。
 *
 * 巡查系統要它做什麼：**判斷施工影響範圍**。一個要封街刨鋪的路段，
 * 旁邊是住宅還是廠區，決定施工時段與交維方式 ——
 * 而那個判斷在只有道路的地圖上做不出來。
 *
 * 只存輪廓與樓高：這裡回答的是「這塊地上有多大的量體」，
 * 不是「這棟樓裡有誰」。
 */
@Entity({ name: 'buildings' })
@Index('idx_building_scope', ['county', 'district'])
export class Building {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** OSM 的物件編號；來源是開放圖資時用它去重 */
  @Column({ name: 'osm_id', type: 'varchar', length: 30, nullable: true })
  osmId?: string;

  @Column({ name: 'county', type: 'varchar', length: 20, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 20, nullable: true })
  district?: string;

  @Column({ name: 'name', type: 'varchar', length: 100, nullable: true })
  name?: string;

  @Column({ name: 'usage', type: 'varchar', length: 16, default: 'RESIDENTIAL' })
  usage!: BuildingUsage;

  @Column({ name: 'levels', type: 'int', default: 1 })
  levels!: number;

  /** 樓高(m)；沒有實測值時由樓層數推估 */
  @Column({ name: 'height_m', type: 'numeric', precision: 6, scale: 2, nullable: true })
  heightM?: string;

  @Column({ name: 'area_m2', type: 'numeric', precision: 12, scale: 2, nullable: true })
  areaM2?: string;

  @Index('idx_building_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Polygon', srid: 4326 })
  geom!: { type: 'Polygon'; coordinates: [number, number][][] };

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
