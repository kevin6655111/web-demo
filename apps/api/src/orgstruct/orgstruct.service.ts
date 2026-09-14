import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, In, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { ModuleNav } from './entities/module.entity';
import { Feature } from './entities/feature.entity';
import { MODULE_DEF } from './module.const';
import type { AuthUser } from '@app-types/user-auth.type';

@Injectable()
export class OrgstructService implements OnModuleInit {
  private readonly logger = new Logger('Orgstruct');

  constructor(
    @InjectRepository(ModuleNav) private readonly moduleRepo: Repository<ModuleNav>,
    @InjectRepository(Feature) private readonly featureRepo: Repository<Feature>
  ) {}

  /**
   * 啟動時把程式碼裡的導覽定義同步進資料庫。
   *
   * 為什麼要同步而不是只讀程式碼：導覽本身要能被「每個站台開不同功能」，
   * 那是資料；但「系統有哪些功能」是程式碼的事實。
   * 同步讓兩者不會分歧 —— 新增功能只要改 MODULE_DEF，重啟就生效。
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.sync();
    } catch (error: any) {
      // 同步失敗不該讓服務起不來：導覽是資料，服務本身還是能用
      this.logger.warn(`導覽同步失敗(不影響服務啟動): ${error?.message}`);
    }
  }

  /** 同步導覽定義（可重複執行） */
  public async sync(): Promise<void> {
    for (const def of MODULE_DEF) {
      const existing = await this.moduleRepo.findOne({ where: { key: def.key } });

      const payload = {
        key: def.key,
        name: def.name,
        icon: def.icon,
        path: def.path,
        defaultSubNav: def.defaultSubNav,
        sortOrder: def.sortOrder
      };

      const moduleId = existing
        ? (await this.moduleRepo.update(existing.id, payload), existing.id)
        : (await this.moduleRepo.save(this.moduleRepo.create(payload))).id;

      for (const fet of def.features) {
        const found = await this.featureRepo.findOne({ where: { key: fet.key } });

        const fetPayload = {
          module: { id: moduleId },
          key: fet.key,
          name: fet.name,
          icon: fet.icon,
          component: fet.component,
          requiredAction: fet.requiredAction,
          sortOrder: fet.sortOrder
        };

        if (found) await this.featureRepo.update(found.id, fetPayload);
        else await this.featureRepo.save(this.featureRepo.create(fetPayload));
      }
    }

    // 定義裡沒有的就刪掉。
    //
    // 只做 upsert 的話，被移除的功能會永遠留在資料庫裡 —— 側邊欄上多一個
    // 點進去沒有畫面的項目，而程式碼裡完全找不到它是哪來的。
    // 先刪功能再刪模組：功能有外鍵指向模組。
    const featureKeys = MODULE_DEF.flatMap((m) => m.features.map((f) => f.key));
    const moduleKeys = MODULE_DEF.map((m) => m.key);

    const staleFeatures = await this.featureRepo.delete({ key: Not(In(featureKeys)) });
    const staleModules = await this.moduleRepo.delete({ key: Not(In(moduleKeys)) });

    const removed = (staleFeatures.affected ?? 0) + (staleModules.affected ?? 0);
    if (removed) this.logger.log(`🧹 清除已移除的導覽項目：功能 ${staleFeatures.affected} 個、模組 ${staleModules.affected} 個`);

    this.logger.log(`🧭 導覽同步完成：${MODULE_DEF.length} 個模組`);
  }

  /**
   * 取得使用者的導覽。
   *
   * 依權限過濾到「子功能」這一層，並丟掉整個模組都沒有可用功能的項目 ——
   * 側邊欄上出現一個點進去什麼都沒有的模組，比不顯示更糟。
   */
  public async getUserNav(user: AuthUser): Promise<HttpResult> {
    const modules = await this.moduleRepo.find({ relations: { features: true }, order: { sortOrder: 'ASC' } });
    const owned = new Set(user.actions ?? []);

    const nav = modules
      .map((m) => ({
        MODULE_KEY: m.key,
        MODULE_NAME: m.name,
        MODULE_ICON: m.icon ?? null,
        MODULE_PATH: m.path ?? null,
        DEFAULT_SUB_NAV: m.defaultSubNav ?? null,
        SORT_ORDER: m.sortOrder,
        FEATURES: (m.features ?? [])
          .filter((f) => !f.requiredAction || owned.has(f.requiredAction))
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((f) => ({
            FEATURE_KEY: f.key,
            FEATURE_NAME: f.name,
            FEATURE_ICON: f.icon ?? null,
            COMPONENT: f.component ?? null,
            REQUIRED_ACTION: f.requiredAction ?? null,
            SORT_ORDER: f.sortOrder
          }))
      }))
      .filter((m) => m.FEATURES.length > 0);

    return HttpResponse.success({ data: nav });
  }
}
