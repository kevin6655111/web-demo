import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { JURISDICTION_DEF, keysOf, type KeyDef } from '@road-patrol/shared';

export const JURISDICTION = keysOf(JURISDICTION_DEF as readonly KeyDef[]);
export type Jurisdiction = (typeof JURISDICTION_DEF)[number]['key'];

/**
 * 道路線段清冊。
 *
 * 來源是政府圖資，而圖資有兩個特性讓它不能直接拿來用：
 *
 *   **一、名稱不完整**。相當比例的線段 `road_name` 是空的或只有代碼，
 *   在圖台上顯示成一堆無名的線。所以有 `display_name` ——
 *   人工命名之後蓋掉原始名稱，但原始名稱留著以便對照下一版圖資。
 *
 *   **二、管轄單位混在一起**。市府、公所、公路單位的路在同一份圖資裡，
 *   巡查標案只負責其中一部分。不標管轄的話，覆蓋率的分母永遠是錯的。
 *
 * `is_active` 是「這一段納不納入巡查」，與管轄是兩件事 ——
 * 歸市府管但正在施工的路段，管轄仍是市府，但這個月不巡。
 */
@Entity({ name: 'road_lines' })
@Unique('uq_road_line_code', ['company', 'code'])
@Index('idx_road_line_name', ['company', 'roadName'])
export class RoadLine {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  /** 圖資原始名稱；可能是空字串 */
  @Column({ name: 'road_name', type: 'varchar', length: 100 })
  roadName!: string;

  /** 人工命名；有值時畫面與報表都以它為準 */
  @Column({ name: 'display_name', type: 'varchar', length: 100, nullable: true })
  displayName?: string;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'jurisdiction', type: 'varchar', length: 10, default: 'CITY' })
  jurisdiction!: Jurisdiction;

  @Column({ name: 'lane_count', type: 'int', default: 2 })
  laneCount!: number;

  @Column({ name: 'length_m', type: 'numeric', precision: 10, scale: 2, default: 0 })
  lengthM!: string;

  /** 納不納入巡查；與管轄是兩件事 */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Index('idx_road_line_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'LineString', srid: 4326 })
  geom!: { type: 'LineString'; coordinates: [number, number][] };

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
