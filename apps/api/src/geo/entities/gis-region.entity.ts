import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 行政層級：縣市 → 鄉鎮市區 → 村里 */
export const REGION_LEVEL = ['COUNTY', 'DISTRICT', 'VILLAGE'] as const;
export type RegionLevel = (typeof REGION_LEVEL)[number];

/**
 * 行政區界線。
 *
 * 三層存在同一張表而不是三張：查詢幾乎都是「給我這個層級的所有面」，
 * 拆三張表會讓那句話變成三段 UNION，而欄位有九成相同。
 *
 * **里這一層是關鍵**：派工是按里分派的(「這個里歸第一班」)，
 * 報表上業主要的也是里別統計。只到區的話，一個區有三十個里，
 * 「這件在哪裡」還是答不出來。
 *
 * 界線是面而不是點：判斷「這個座標屬於哪個里」要用 `ST_Contains`，
 * 而那需要真的多邊形。
 */
@Entity({ name: 'gis_regions' })
@Unique('uq_gis_region_code', ['level', 'countyCode', 'districtCode', 'villageCode'])
@Index('idx_gis_region_level', ['level', 'county', 'district'])
export class GisRegion {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'county_code', type: 'varchar', length: 10 })
  countyCode!: string;

  @Column({ name: 'county', type: 'varchar', length: 20 })
  county!: string;

  @Column({ name: 'district_code', type: 'varchar', length: 10, nullable: true })
  districtCode?: string;

  @Column({ name: 'district', type: 'varchar', length: 20, nullable: true })
  district?: string;

  @Column({ name: 'village_code', type: 'varchar', length: 12, nullable: true })
  villageCode?: string;

  @Column({ name: 'village', type: 'varchar', length: 30, nullable: true })
  village?: string;

  @Column({ name: 'level', type: 'varchar', length: 10 })
  level!: RegionLevel;

  @Index('idx_gis_region_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Polygon', srid: 4326 })
  geom!: { type: 'Polygon'; coordinates: [number, number][][] };

  @Column({ name: 'area_km2', type: 'numeric', precision: 12, scale: 4, nullable: true })
  areaKm2?: string;

  @Column({ name: 'note', type: 'varchar', length: 100, nullable: true })
  note?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
