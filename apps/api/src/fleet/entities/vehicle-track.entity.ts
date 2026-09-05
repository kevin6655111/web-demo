import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Company } from '@entities/company.entity';
import { Project } from '@/project/entities/project.entity';
import { Vehicle } from './vehicle.entity';

/**
 * 巡查軌跡點。
 *
 * 這是全系統資料量最大的表：一台車每 5 秒一筆，十台車跑八小時就是十萬筆。
 * 因此：
 *   - 索引只建真的會用到的(車輛 + 時間)，多一條索引就多一份寫入成本
 *   - 不做關聯查詢，取軌跡時直接依車輛與時間掃描
 *   - 保留期由排程控制，不是無限成長
 */
@Entity({ name: 'vehicle_tracks' })
@Index('idx_track_vehicle_time', ['vehicle', 'recordedAt'])
@Index('idx_track_company_time', ['company', 'recordedAt'])
export class VehicleTrack {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Vehicle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: Vehicle;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Index('idx_track_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  geom!: { type: 'Point'; coordinates: [number, number] };

  @Column({ name: 'speed_kph', type: 'real', default: 0 })
  speedKph!: number;

  @Column({ name: 'heading', type: 'real', nullable: true })
  heading?: number;

  /** GPS 品質；HDOP 太大時這個點不該拿來畫軌跡 */
  @Column({ name: 'gps_hdop', type: 'real', nullable: true })
  gpsHdop?: number;

  @Column({ name: 'altitude', type: 'real', nullable: true })
  altitude?: number;

  /** 是否為一趟巡查的起點；用來把連續的點切成一段一段的行程 */
  @Column({ name: 'is_trip_start', type: 'boolean', default: false })
  isTripStart!: boolean;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;
}
