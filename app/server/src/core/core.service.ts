import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { Announcement, type AnnouncementLevel } from './announcement.entity';
import { CASE_SOURCE } from '@/case-patrol/entities/patrol-case.entity';
import { MAINTAIN_LEVEL } from '@/road-eval/entities/road-segment.entity';
import { VEHICLE_STATE, VEHICLE_TYPE } from '@/fleet/entities/vehicle.entity';
import { SURVEY_METHOD } from '@/survey/entities/survey-case.entity';
import {
  CASE_EDITED_DEF,
  CASE_STATUS_DEF,
  IMAGE_GROUPS,
  CRACK_TYPE_DEF,
  DEGREE_DEF,
  IMAGE_TYPE_DEF,
  MATERIAL_DEF,
  NEED_REPAIR_DEF,
  PERIOD_DEF,
  REQUIRED_IMAGES,
  SURVEY_STATUS_DEF,
  TEST_ITEM_DEF,
  WEATHER_DEF,
  WORK_ORDER_STATUS_DEF,
  WORK_ORDER_TYPE_DEF
} from './constants/type-def.const';
import type { AuthUser } from '@app-types/user-auth.type';
import { UpsertAnnouncementDto } from './core.dto';

/** 只有這幾張表是字串列舉，其餘代碼表直接來自常數定義 */
const SIMPLE_LABELS: Record<string, Record<string, string>> = {
  CASE_SOURCE: { VEHICLE: 'AI 車巡', APP: 'APP 巡查', SIDEWALK: '通道案件' },
  MAINTAIN_LEVEL: { GOOD: '良好', FAIR: '尚可', POOR: '不良', CRITICAL: '危險' },
  VEHICLE_TYPE: { PATROL: '巡查車', REPAIR: '維修車', SURVEY: '檢測車' },
  VEHICLE_STATE: { ONLINE: '在線', IDLE: '待命', OFFLINE: '離線', DISABLED: '停用' },
  SURVEY_METHOD: { VISUAL: '目視', CORE_DRILL: '鑽心取樣', FWD: '落重撓度', ROUGHNESS: '平坦度' }
};

@Injectable()
export class CoreService {
  constructor(@InjectRepository(Announcement) private readonly announcementRepo: Repository<Announcement>) {}

  /**
   * 代碼表。
   *
   * 前端不該自己維護一份中文對照 —— 那份一定會過期。
   * 後端新增一個破壞類型時，前端的下拉選單應該自己多一個選項。
   *
   * 順帶回傳每個代碼的原始順序：狀態的排列有意義(新報 → 派工 → 完修)，
   * 前端不該用字母排序把它打亂。
   */
  public getCodeTables(): HttpResult {
    const stringEnums = { CASE_SOURCE, MAINTAIN_LEVEL, VEHICLE_TYPE, VEHICLE_STATE, SURVEY_METHOD } as const;

    const fromStrings = Object.fromEntries(
      Object.entries(stringEnums).map(([table, values]) => [
        table,
        (values as readonly string[]).map((value, order) => ({ VALUE: value, LABEL: SIMPLE_LABELS[table]?.[value] ?? value, ORDER: order }))
      ])
    );

    // 帶結構的定義直接轉出去：破壞類型有臺北專用名稱、照片類型有「是不是壓縮檔」，
    // 這些欄位前端都用得到，壓成 value/label 兩欄反而要再打一支 API 問
    const data = {
      ...fromStrings,
      CRACK_TYPE: CRACK_TYPE_DEF.map((c, order) => ({ VALUE: c.key, LABEL: c.name, LABEL_TAIPEI: c.nameTaipei, ORDER: order })),
      DEGREE: DEGREE_DEF.map((d, order) => ({ VALUE: d.key, LABEL: d.name, ORDER: order })),
      CASE_STATUS: CASE_STATUS_DEF.map((s, order) => ({ VALUE: s.value, LABEL: s.name, COLOR: s.color, ORDER: order })),
      CASE_EDITED: CASE_EDITED_DEF.map((s, order) => ({ VALUE: s.value, LABEL: s.name, ORDER: order })),
      NEED_REPAIR: NEED_REPAIR_DEF.map((s, order) => ({ VALUE: s.value, LABEL: s.name, COLOR: s.color, ORDER: order })),
      WORK_ORDER_TYPE: WORK_ORDER_TYPE_DEF.map((t, order) => ({ VALUE: t.key, LABEL: t.name, NEED_SOURCE: t.needSource, ORDER: order })),
      WORK_ORDER_STATUS: WORK_ORDER_STATUS_DEF.map((s, order) => ({ VALUE: s.value, LABEL: s.name, COLOR: s.color, ORDER: order })),
      SURVEY_STATUS: SURVEY_STATUS_DEF.map((s, order) => ({ VALUE: s.value, LABEL: s.name, COLOR: s.color, ORDER: order })),
      MATERIAL: MATERIAL_DEF.map((m, order) => ({ VALUE: m.key, LABEL: m.name, ORDER: order })),
      TEST_ITEM: TEST_ITEM_DEF.map((t, order) => ({ VALUE: t, LABEL: t, ORDER: order })),
      PERIOD: PERIOD_DEF.map((p, order) => ({ VALUE: p.key, LABEL: p.name, ORDER: order })),
      WEATHER: WEATHER_DEF.map((w, order) => ({ VALUE: w.key, LABEL: w.name, ORDER: order })),
      IMAGE_TYPE: IMAGE_TYPE_DEF.map((i, order) => ({ VALUE: i.type, LABEL: i.name, IS_ZIP: i.zip, ORDER: order })),
      REQUIRED_IMAGES,
      // 照片分區：前端的派工單表單直接照這個排版，不再自己維護一份
      IMAGE_GROUPS: Object.fromEntries(
        Object.entries(IMAGE_GROUPS).map(([type, groups]) => [
          type,
          groups.map((g) => ({
            GROUP: g.group,
            TYPES: g.types.map((t) => ({
              TYPE: t,
              NAME: IMAGE_TYPE_DEF.find((d) => d.type === t)?.name ?? t,
              IS_ZIP: IMAGE_TYPE_DEF.find((d) => d.type === t)?.zip ?? false,
              REQUIRED: (REQUIRED_IMAGES[type] ?? []).includes(t)
            }))
          }))
        ])
      )
    };

    return HttpResponse.success({ data });
  }

  /** 目前生效中的公告 */
  public async getAnnouncements(companyId: number): Promise<HttpResult> {
    const rows = await this.announcementRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.author', 'u')
      .where('a.company_id = :companyId', { companyId })
      .andWhere('a.start_at <= now()')
      .andWhere('(a.end_at IS NULL OR a.end_at > now())')
      .orderBy('a.pinned', 'DESC')
      .addOrderBy('a.start_at', 'DESC')
      .getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((a) => ({
        ID: a.id,
        TITLE: a.title,
        BODY: a.body,
        LEVEL: a.level,
        PINNED: a.pinned,
        START_AT: a.startAt,
        END_AT: a.endAt ?? null,
        AUTHOR: a.author?.name ?? null
      })),
      warnMsg: '目前沒有公告'
    });
  }

  /** 新增或更新公告 */
  public async upsertAnnouncement(dto: UpsertAnnouncementDto, user: AuthUser): Promise<HttpResult> {
    const payload = {
      company: { id: user.companyId },
      title: dto.TITLE,
      body: dto.BODY,
      level: (dto.LEVEL ?? 'INFO') as AnnouncementLevel,
      startAt: dto.START_AT ? new Date(dto.START_AT) : new Date(),
      endAt: dto.END_AT ? new Date(dto.END_AT) : undefined,
      pinned: dto.PINNED ?? false,
      author: { id: user.uid }
    };

    if (dto.ID) {
      const result = await this.announcementRepo.update({ id: dto.ID, company: { id: user.companyId } }, payload);
      if (!result.affected) throw new NotFoundException(`找不到公告：${dto.ID}`);

      return HttpResponse.success({ message: '公告已更新', data: { ID: dto.ID } });
    }

    const saved = await this.announcementRepo.save(this.announcementRepo.create(payload));
    return HttpResponse.success({ message: '公告已發布', data: { ID: saved.id } });
  }

  /** 刪除公告 */
  public async deleteAnnouncement(id: number, companyId: number): Promise<HttpResult> {
    const result = await this.announcementRepo.delete({ id, company: { id: companyId } });
    if (!result.affected) throw new NotFoundException(`找不到公告：${id}`);

    return HttpResponse.success({ message: '公告已刪除' });
  }
}
