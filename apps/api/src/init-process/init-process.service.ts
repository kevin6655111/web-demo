import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EnvService } from '@/env/env.service';
import { StorageService } from '@/storage/storage.service';
import { GeoService } from '@/geo/geo.service';

type CheckResult = { name: string; ok: boolean; detail?: string };

/**
 * 開機自檢。
 *
 * 檢查「這個環境能不能正常運作」，而不是初始化資料 —— 資料由 migration 與 seed 負責。
 *
 * 為什麼需要這一支：這個系統對外部環境有幾個**沉默的依賴**，
 * 缺了不會在啟動時報錯，而是在第一個使用者踩到時才炸：
 *
 *   - PostGIS 沒裝 → 任何空間查詢都是 `function st_dwithin does not exist`，
 *     而那句話看起來像程式寫錯，不像資料庫少裝東西
 *   - 物件儲存的 bucket 不存在 → 上傳照片時失敗，但案件已經建立了，
 *     結果是一筆沒有照片的案件，而沒有人知道照片去哪了
 *   - 時區不一致 → 「今天的案件」會差幾個小時，只有跨日的那幾筆看得出來
 *
 * **檢查失敗不擋住啟動**：這些是降級而不是致命 —— 沒有物件儲存時，
 * 系統仍然收得到車機的案件。擋住啟動會讓一個可以部分運作的系統完全不能用。
 *
 * 但一定要留下 error 等級的日誌：問題要看得見，而不是等使用者來報。
 */
@Injectable()
export class InitProcessService implements OnModuleInit {
  private readonly logger = new Logger('Init');

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly envService: EnvService,
    private readonly geoService: GeoService
  ) {}

  async onModuleInit(): Promise<void> {
    const results = await Promise.all([this.checkPostgis(), this.checkStorage(), this.checkTimezone()]);

    const failed = results.filter((r) => !r.ok);
    if (!failed.length) {
      this.logger.log(`🩺 環境自檢通過：${results.map((r) => r.name).join('、')}`);
      await this.warmCache();
      return;
    }

    for (const item of failed) this.logger.error(`🩺 ${item.name}：${item.detail}`);
    this.logger.warn(`🩺 ${failed.length} 項自檢未通過，服務仍會啟動但相關功能會失敗`);
  }

  /**
   * 預熱快取。
   *
   * 自檢之後做，而不是之前：Redis 或資料庫不通時，預熱只會多印一串失敗訊息，
   * 蓋掉真正有用的自檢結果。
   *
   * **只預熱「開機就能算、算完很久不變」的東西**。
   * 把會變動的資料也預熱，等於在開機時就先產生一批準備要過期的快取 ——
   * 多花的時間換不到任何命中。目前符合條件的只有行政區界線：
   * 一年更新一次，而所有開啟圖台的人拿到的是同一份。
   *
   * 案件統計、標案彙總這些雖然也很貴，但它們**依公司而不同且隨時在變**，
   * 走各自端點上的 `remember()` 由第一個查詢的人觸發才合理。
   *
   * 失敗不擋啟動也不算自檢失敗：預熱失敗的唯一後果是
   * 「今天第一個打開圖台的人要多等一下」。
   */
  private async warmCache(): Promise<void> {
    try {
      const warmed = await this.geoService.warmRegionCache();
      const detail = warmed.map((w) => `${w.level} ${w.features} 面`).join('、');

      this.logger.log(`🔥 快取預熱完成：行政區界線(${detail})`);
    } catch (error: any) {
      this.logger.warn(`🔥 快取預熱失敗(${error?.message})；首次查詢會改為即時計算`);
    }
  }

  /** PostGIS：所有空間查詢的前提 */
  private async checkPostgis(): Promise<CheckResult> {
    try {
      const [row] = await this.dataSource.query(`SELECT PostGIS_Version() AS version`);
      return { name: `PostGIS ${row?.version ?? ''}`.trim(), ok: true };
    } catch (error: any) {
      return {
        name: 'PostGIS',
        ok: false,
        detail: `擴充未安裝或無法使用(${error?.message})；所有空間查詢都會失敗。請執行 CREATE EXTENSION postgis`
      };
    }
  }

  /** 物件儲存：照片與報表的落腳處 */
  private async checkStorage(): Promise<CheckResult> {
    if (this.envService.getStorageBackend() !== 'MINIO') return { name: '物件儲存(未啟用)', ok: true };

    try {
      const bucket = this.envService.getMinioConfig().bucket;
      // 用一個一定不存在的 key 探測：能回答「不存在」就代表連得上且 bucket 在
      await this.storageService.exists(`__healthcheck__/${Date.now()}`);

      return { name: `物件儲存(${bucket})`, ok: true };
    } catch (error: any) {
      return { name: '物件儲存', ok: false, detail: `無法存取 bucket(${error?.message})；照片上傳與報表下載會失敗` };
    }
  }

  /**
   * 時區。
   *
   * 排程用 `Asia/Taipei` 註冊，但 `date_trunc('day', ...)` 這類 SQL 用的是
   * 資料庫的時區 —— 兩者不一致時，「今天的案件」會差幾個小時。
   */
  private async checkTimezone(): Promise<CheckResult> {
    try {
      const [row] = await this.dataSource.query(`SHOW TIME ZONE`);
      const dbTz = row?.TimeZone ?? row?.timezone ?? '(unknown)';
      const appTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const ok = dbTz === appTz;

      return {
        name: `時區(db=${dbTz} app=${appTz})`,
        ok,
        detail: ok ? undefined : '資料庫與應用程式時區不一致；跨日的統計會差幾個小時'
      };
    } catch (error: any) {
      return { name: '時區', ok: false, detail: error?.message };
    }
  }
}
