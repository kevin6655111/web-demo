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
import { RoadLine } from './road-line.entity';
import { ROAD_BLOCK_STATUS_DEF, ROAD_BLOCK_TYPE_DEF, keysOf, valuesOf, type KeyDef } from '@road-patrol/shared';

export const ROAD_BLOCK_TYPE = keysOf(ROAD_BLOCK_TYPE_DEF as readonly KeyDef[]);
export const ROAD_BLOCK_STATUS = valuesOf(ROAD_BLOCK_STATUS_DEF);
export type RoadBlockType = (typeof ROAD_BLOCK_TYPE_DEF)[number]['key'];

/**
 * 道路區塊（面）。
 *
 * 線段回答「這條路在哪裡」，區塊回答「這一段路有多大」——
 * 計價、鋪面面積、養護預算都以面積為單位，而線段只有長度。
 *
 * 面積由 PostGIS 從幾何算出來而不是相信匯入的數字：
 * 圖資的面積欄位常是不同投影下算的，加總起來會跟實際差幾個百分點。
 */
@Entity({ name: 'road_blocks' })
@Unique('uq_road_block_code', ['company', 'code'])
@Index('idx_road_block_scope', ['company', 'district', 'status'])
export class RoadBlock {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  /** 所屬線段；圖資對不起來時可以留空 */
  @ManyToOne(() => RoadLine, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'road_line_id' })
  roadLine?: RoadLine | null;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'road_name', type: 'varchar', length: 100 })
  roadName!: string;

  @Column({ name: 'county', type: 'varchar', length: 10, nullable: true })
  county?: string;

  @Column({ name: 'district', type: 'varchar', length: 10, nullable: true })
  district?: string;

  @Column({ name: 'block_type', type: 'varchar', length: 12, default: 'MAIN' })
  blockType!: RoadBlockType;

  /** 0 未設定 / 1 納入巡查 / 2 不納入 / 3 施工中 */
  @Column({ name: 'status', type: 'int', default: 0 })
  status!: number;

  @Column({ name: 'lane_count', type: 'int', default: 2 })
  laneCount!: number;

  @Column({ name: 'width_m', type: 'numeric', precision: 6, scale: 2, nullable: true })
  widthM?: string;

  @Column({ name: 'length_m', type: 'numeric', precision: 10, scale: 2, nullable: true })
  lengthM?: string;

  @Column({ name: 'area_m2', type: 'numeric', precision: 12, scale: 2, nullable: true })
  areaM2?: string;

  @Index('idx_road_block_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Polygon', srid: 4326 })
  geom!: { type: 'Polygon'; coordinates: [number, number][][] };

  @Column({ name: 'remark', type: 'varchar', length: 200, nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
