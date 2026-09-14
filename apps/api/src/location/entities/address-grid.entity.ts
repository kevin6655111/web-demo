import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * 門牌圖資的載入進度。
 *
 * 外部圖資服務以區塊為單位供應，且有流量限制，無法在每次查詢時即時呼叫。
 * 此表記錄「哪些網格已經載入過」，避免對同一區域重複請求。
 *
 * 記錄網格而非記錄查詢結果的原因：某個網格內查無門牌，本身就是需要記住的結果。
 * 只記錄成功結果的話，空白區域會在每次查詢時重新請求一次。
 */
@Entity({ name: 'address_grids' })
@Unique('uq_address_grid', ['gridX', 'gridY'])
export class AddressGrid {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** 網格座標，以 0.01 度為一格（約 1.1 公里） */
  @Column({ name: 'grid_x', type: 'int' })
  gridX!: number;

  @Column({ name: 'grid_y', type: 'int' })
  gridY!: number;

  /** 該網格載入到的門牌數；0 代表確認過沒有門牌 */
  @Column({ name: 'point_count', type: 'int', default: 0 })
  pointCount!: number;

  @UpdateDateColumn({ name: 'loaded_at', type: 'timestamptz' })
  loadedAt!: Date;
}
