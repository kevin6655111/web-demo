import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Company } from '@entities/company.entity';
import { User } from '@entities/user.entity';
import { Project } from '@/project/entities/project.entity';
import { Vehicle } from '@/fleet/entities/vehicle.entity';
import { PatrolCaseAddress } from './patrol-case-address.entity';
import { PatrolCaseStatus } from './patrol-case-status.entity';

/** 案件來源：三種來源共用同一張表，欄位與流程一致 */
import { CASE_SOURCE_DEF, keysOf, type CaseSource } from '@road-patrol/shared';

/** 代碼清單由定義推導；中文名與代碼住在同一處，見 @road-patrol/shared */
export const CASE_SOURCE = keysOf(CASE_SOURCE_DEF);
export type { CaseSource };

/**
 * 車巡案件（主表）。
 *
 * 資料切成三張表，因為它們的**寫入者與寫入時機都不同**：
 *   patrol_cases          車機上傳，一次寫入後幾乎不再變動
 *   patrol_case_address   逆地理編碼補上，由 worker 非同步寫入
 *   patrol_case_statuses  二篩、編輯、派工判定，由人在不同時間改
 *
 * 混在一張表的話，車機每上傳一筆就要鎖住整列，而承辦正在改的狀態欄位
 * 也在同一列上 —— 高頻寫入與人工編輯會互相卡住。
 */
@Entity({ name: 'patrol_cases' })
// 同一台車、同一時間、同一個破壞編號只會有一筆：這是冪等的最後防線。
// 車機重送用的是這組值，而不是流水號 —— 流水號在重送時會變。
@Unique('uq_case_dt_img_crack', ['dtRecord', 'imgDetect', 'crackId'])
@Unique('uq_case_external_id', ['externalId'])
@Index('idx_case_case_num', ['caseNum'])
@Index('idx_case_company_dt', ['company', 'dtRecord'])
@Index('idx_case_crack_degree', ['crackType', 'degree'])
@Index('idx_case_company_source', ['company', 'source'])
export class PatrolCase {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  /** 系統編碼的案件編號（標案代碼 + 類型 + 年月 + 流水），對外文件用這個 */
  @Column({ name: 'case_num', type: 'varchar', length: 30, nullable: true })
  caseNum?: string;

  /** 上游系統給的識別碼，重送時值不變 */
  @Column({ name: 'external_id', type: 'varchar', length: 60 })
  externalId!: string;

  @Column({ name: 'source', type: 'varchar', length: 10, default: 'VEHICLE' })
  source!: CaseSource;

  /** 車機記錄時間，毫秒精度 —— 同一秒內可能有多筆 */
  @Column({ name: 'dt_record', type: 'timestamptz', precision: 3 })
  dtRecord!: Date;

  // ─── 車輛 ───────────────────────────────────────────────────────

  @Column({ name: 'car', type: 'varchar', length: 20, nullable: true })
  car?: string;

  @ManyToOne(() => Vehicle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle?: Vehicle;

  // ─── 破壞 ───────────────────────────────────────────────────────

  @Column({ name: 'crack_type', type: 'varchar', length: 30 })
  crackType!: string;

  /** 破壞程度 A/B/C，A 最嚴重 */
  @Column({ name: 'degree', type: 'varchar', length: 1, default: 'C' })
  degree!: string;

  /** 同一張影像上的第幾個破壞；與時間、影像共同構成唯一鍵 */
  @Column({ name: 'crack_id', type: 'int', default: 0 })
  crackId!: number;

  @Column({ name: 'length', type: 'double precision', default: 0 })
  length!: number;

  @Column({ name: 'width', type: 'double precision', default: 0 })
  width!: number;

  @Column({ name: 'area', type: 'double precision', default: 0 })
  area!: number;

  @Column({ name: 'depth', type: 'double precision', nullable: true })
  depth?: number;

  // ─── 影像 ───────────────────────────────────────────────────────

  /** 原始影像 */
  @Column({ name: 'img', type: 'varchar', length: 255, nullable: true })
  img?: string;

  /** AI 標註後的影像；與原圖分開存，爭議時要能比對 AI 判了什麼 */
  @Column({ name: 'img_detect', type: 'varchar', length: 255, nullable: true })
  imgDetect?: string;

  /** 破壞在影像上的位置（像素框），供前端在圖上畫框 */
  @Column({ name: 'img_map_area', type: 'varchar', length: 50, nullable: true })
  imgMapArea?: string;

  // ─── 座標 ───────────────────────────────────────────────────────

  @Column({ name: 'longitude', type: 'double precision' })
  longitude!: number;

  @Column({ name: 'latitude', type: 'double precision' })
  latitude!: number;

  @Column({ name: 'altitude', type: 'real', nullable: true })
  altitude?: number;

  /** 車輛當下的方位角(0–359)；GPS 校正靠它決定往哪個方向推 */
  @Column({ name: 'heading', type: 'real', nullable: true })
  heading?: number;

  /**
   * 車機回報的原始座標。
   *
   * `longitude`/`latitude` 存的是校正後的值。原始值另存一份，
   * 因為校正的假設(天線在車頂、破壞在鏡頭正前方 5 公尺)不見得每種車機都成立 ——
   * 換了車機之後發現偏得更遠時，要有東西可以重算。
   */
  @Column({ name: 'raw_longitude', type: 'double precision', nullable: true })
  rawLongitude?: number;

  @Column({ name: 'raw_latitude', type: 'double precision', nullable: true })
  rawLatitude?: number;

  /**
   * 空間欄位。
   * 經緯度另外存 double：報表與 CSV 匯出要的是數字，
   * 每次從 geometry 抽出來會讓查詢慢上一個數量級。
   */
  @Index('idx_case_geom', { spatial: true })
  @Column({ name: 'geom', type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  geom!: { type: 'Point'; coordinates: [number, number] };

  /** 車機當日的流水序號，對帳用 */
  @Column({ name: 'serial_no', type: 'int', nullable: true })
  serialNo?: number;

  /** 影像在車機上的原始路徑，追查原始檔用 */
  @Column({ name: 'path', type: 'varchar', length: 255, nullable: true })
  path?: string;

  @Column({ name: 'remark', type: 'varchar', length: 300, nullable: true })
  remark?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reporter_id' })
  reporter?: User;

  @OneToOne(() => PatrolCaseAddress, (a) => a.patrolCase)
  address?: PatrolCaseAddress;

  @OneToOne(() => PatrolCaseStatus, (s) => s.patrolCase)
  status?: PatrolCaseStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
