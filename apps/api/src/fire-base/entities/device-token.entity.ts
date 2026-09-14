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
import { User } from '@entities/user.entity';

/** 裝置平台；推播內容的欄位結構依平台而異 */
export const DEVICE_PLATFORM = ['ANDROID', 'IOS', 'WEB'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORM)[number];

/**
 * 推播裝置註冊。
 *
 * 一位使用者可能有多個裝置（工地手機、辦公室瀏覽器），因此以裝置權杖為主鍵單位，
 * 而非每位使用者一筆。
 *
 * 權杖會失效（重裝應用程式、長期未使用），推播服務會在回應中告知。
 * 失效的權杖標記為停用而非刪除 —— 保留紀錄才能回答
 * 「這位施工人員的手機是什麼時候不再接收通知的」。
 */
@Entity({ name: 'device_tokens' })
@Unique('uq_device_token', ['token'])
@Index('idx_device_token_user', ['user', 'isActive'])
export class DeviceToken {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** 推播服務發給該裝置的權杖 */
  @Column({ name: 'token', type: 'varchar', length: 255 })
  token!: string;

  @Column({ name: 'platform', type: 'varchar', length: 10 })
  platform!: DevicePlatform;

  /** 裝置識別名稱，例如手機型號；用於讓使用者辨認要停用哪一台 */
  @Column({ name: 'device_name', type: 'varchar', length: 100, nullable: true })
  deviceName?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** 最後一次成功推播的時間；用於清理長期無回應的裝置 */
  @Column({ name: 'last_pushed_at', type: 'timestamptz', nullable: true })
  lastPushedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
