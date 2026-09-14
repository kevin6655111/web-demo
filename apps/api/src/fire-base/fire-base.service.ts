import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeviceToken, type DevicePlatform } from './entities/device-token.entity';

/** 一次推播的內容 */
export type PushMessage = {
  title: string;
  body: string;
  /** 點擊通知後要開啟的頁面，例如 `/workorder?ID=413` */
  link?: string;
  /** 附帶資料；前端據此決定要不要重新整理某個畫面 */
  data?: Record<string, string>;
};

/** 推播結果 */
export type PushResult = {
  targeted: number;
  delivered: number;
  deactivated: number;
  /** 憑證未設定時為 true：流程完整走過，但未實際送出 */
  dryRun: boolean;
};

@Injectable()
export class FireBaseService {
  private readonly logger = new Logger('FireBase');

  constructor(@InjectRepository(DeviceToken) private readonly tokenRepo: Repository<DeviceToken>) {}

  /**
   * FCM 憑證是否已設定。
   *
   * 未設定時進入記錄模式：查詢目標裝置、記錄推播內容，但不實際送出。
   * 這讓「誰會收到這則通知」在沒有憑證的環境下仍可驗證 ——
   * 而那正是推播最容易出錯的部分。
   */
  public get configured(): boolean {
    return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_B64);
  }

  /** 註冊或更新裝置權杖 */
  public async register(
    userId: number,
    token: string,
    platform: DevicePlatform,
    deviceName?: string
  ): Promise<DeviceToken> {
    const existing = await this.tokenRepo.findOne({ where: { token } });

    if (existing) {
      // 同一個權杖換人使用：裝置轉手或共用手機，要改綁到現在的使用者
      await this.tokenRepo.update({ id: existing.id }, { user: { id: userId }, platform, deviceName, isActive: true });
      return await this.tokenRepo.findOneOrFail({ where: { id: existing.id } });
    }

    return await this.tokenRepo.save(
      this.tokenRepo.create({ user: { id: userId }, token, platform, deviceName, isActive: true })
    );
  }

  /** 停用某個權杖；使用者登出或手動移除裝置時呼叫 */
  public async deactivate(token: string): Promise<void> {
    await this.tokenRepo.update({ token }, { isActive: false });
  }

  /**
   * 推播給指定的使用者。
   *
   * 一位使用者可能有多個裝置，全部都送。單一裝置失敗不影響其他裝置 ——
   * 手機換過的施工人員仍應在瀏覽器上收到通知。
   */
  public async pushToUsers(userIds: number[], message: PushMessage): Promise<PushResult> {
    if (!userIds.length) return { targeted: 0, delivered: 0, deactivated: 0, dryRun: !this.configured };

    const tokens = await this.tokenRepo.find({
      where: { user: { id: In(userIds) }, isActive: true },
      relations: { user: true }
    });

    if (!tokens.length) {
      this.logger.debug(`無可用裝置：使用者 ${userIds.join(', ')}`);
      return { targeted: 0, delivered: 0, deactivated: 0, dryRun: !this.configured };
    }

    if (!this.configured) {
      this.logger.log(`📵 記錄模式（未設定 FCM 憑證）：「${message.title}」→ ${tokens.length} 個裝置`);
      return { targeted: tokens.length, delivered: 0, deactivated: 0, dryRun: true };
    }

    // 正式環境在此呼叫 FCM 的批次送出，並依回應停用失效的權杖。
    // Demo 不引入 firebase-admin：它會出現在後端映像檔裡，而這裡永遠不會執行到。
    this.logger.warn(`FCM 憑證已設定但傳輸實作未接上：「${message.title}」→ ${tokens.length} 個裝置`);
    throw new Error('FCM 傳輸實作未接上；請在 FireBaseService.pushToUsers 中接上 firebase-admin');
  }

  /** 使用者名下的裝置清單 */
  public async listDevices(userId: number): Promise<DeviceToken[]> {
    return await this.tokenRepo.find({ where: { user: { id: userId } }, order: { updatedAt: 'DESC' } });
  }

  /** 各平台的有效裝置數；維運用來確認推播涵蓋範圍 */
  public async stats(): Promise<{ platform: string; active: number }[]> {
    return await this.tokenRepo
      .createQueryBuilder('d')
      .select('d.platform', 'platform')
      .addSelect('COUNT(*) FILTER (WHERE d.is_active)::int', 'active')
      .groupBy('d.platform')
      .getRawMany<{ platform: string; active: number }>();
  }
}
