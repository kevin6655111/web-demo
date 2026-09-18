import { Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/** 鋪面類型：計價單價依它而不同 */
export const PAVEMENT_TYPE = ['AC', 'CC', 'MIXED'] as const;
export type PavementType = (typeof PAVEMENT_TYPE)[number];

/**
 * 道路量測資料。
 *
 * 計價的分母：契約寫「每平方公尺多少錢」，而面積 = 長度 × 寬度。
 * 這份資料來自主管機關的道路清冊，與圖形(`road_lines`)分開存 ——
 * 量測值的更新頻率是一年一次，圖形則可能因為新闢道路隨時變動。
 *
 * 合併成一張表的話，每次更新量測值都要碰到幾何欄位，
 * 而那是整張表最大的欄位。
 */
@Entity({ name: 'road_meas' })
@Unique('uq_road_meas', ['county', 'roadNum'])
@Index('idx_road_meas_name', ['county', 'roadName'])
export class RoadMeas {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'county', type: 'varchar', length: 20 })
  county!: string;

  @Column({ name: 'district', type: 'varchar', length: 20, nullable: true })
  district?: string;

  /** 道路編號；主管機關的清冊以它為主鍵 */
  @Column({ name: 'road_num', type: 'varchar', length: 20 })
  roadNum!: string;

  @Column({ name: 'road_name', type: 'varchar', length: 100 })
  roadName!: string;

  @Column({ name: 'length_m', type: 'numeric', precision: 10, scale: 2, default: 0 })
  lengthM!: string;

  @Column({ name: 'width_m', type: 'numeric', precision: 6, scale: 2, default: 0 })
  widthM!: string;

  @Column({ name: 'lane_count', type: 'int', default: 2 })
  laneCount!: number;

  @Column({ name: 'pavement', type: 'varchar', length: 12, default: 'AC' })
  pavement!: PavementType;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
