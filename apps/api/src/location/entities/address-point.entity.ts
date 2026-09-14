import { Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * 門牌點位。
 *
 * 地址與座標的對照來源。系統原本的逆地理編碼是依座標推算出來的假實作，
 * 案件的路名因此只是「看起來像地址」的字串，無法用於公文與計價對帳。
 *
 * 門牌獨立一張表而非附掛於案件，理由有三：
 *
 * 1. 同一個門牌會被大量案件引用，附掛於案件等於同一份資料存上千次。
 * 2. 門牌來自外部圖資（正式環境為國土測繪中心 TGOS），更新週期與案件無關。
 * 3. 地址自動完成需要對「所有門牌」搜尋，而非只有出現過案件的地址。
 */
@Entity({ name: 'address_points' })
@Unique('uq_address_point', ['county', 'district', 'cavlge', 'road', 'number'])
@Index('idx_address_point_road', ['county', 'district', 'road'])
export class AddressPoint {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'county', type: 'varchar', length: 10 })
  county!: string;

  @Column({ name: 'district', type: 'varchar', length: 10 })
  district!: string;

  @Column({ name: 'cavlge', type: 'varchar', length: 10, nullable: true })
  cavlge?: string;

  @Column({ name: 'road', type: 'varchar', length: 50 })
  road!: string;

  /** 門牌號，例如 `99` 或 `99-1` */
  @Column({ name: 'number', type: 'varchar', length: 20 })
  number!: string;

  /** 完整地址；查詢與顯示都用它，避免每次重新拼接 */
  @Column({ name: 'full_address', type: 'varchar', length: 120 })
  fullAddress!: string;

  @Index('idx_address_point_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  geom!: { type: 'Point'; coordinates: [number, number] };

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
