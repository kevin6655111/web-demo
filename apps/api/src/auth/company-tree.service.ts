import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { ACTION_KEYS } from '@constants/module.const';
import type { AuthUser } from '@app-types/user-auth.type';
import { COMPANY_TIER, Company, type CompanyTier } from './entities/company.entity';
import { CompanyGrant } from './entities/company-grant.entity';
import { User } from './entities/user.entity';
import { CreateCompanyDto, GrantActionsDto, SubCompanyQueryDto, UpdateCompanyDto } from './company-tree.dto';

/**
 * 公司樹與授權傳遞。
 *
 * 三層：平台 → 廠商 → 外包。每一層只看得到自己與底下的單位。
 *
 * 兩條規則撐起整個機制：
 *
 * 1. **看得到的只有自己的子樹** —— 廠商查不到平台，也查不到別的廠商。
 *    不是靠畫面隱藏，而是每個查詢都以子樹收斂，直接打 API 也一樣。
 * 2. **開不出自己沒有的權限** —— 上層的授權是下層的上限。
 *    少了這條，廠商可以自己開一個全權限的外包單位，開通機制就等於不存在。
 */
@Injectable()
export class CompanyTreeService {
  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(CompanyGrant) private readonly grantRepo: Repository<CompanyGrant>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource
  ) {}

  /**
   * 目前公司能開通的動作清單 = 自己被開通的那些。
   *
   * 平台層沒有上層，用程式碼裡的完整動作表當上限 ——
   * 否則系統剛裝好時沒有人開得出第一份授權。
   */
  public async getGrantableActions(companyId: number): Promise<string[]> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException(`找不到公司：${companyId}`);

    if (company.tier === COMPANY_TIER.PLATFORM) return [...ACTION_KEYS];

    const grants = await this.grantRepo.find({ where: { company: { id: companyId }, isActive: true } });
    return grants.map((g) => g.actionKey);
  }

  /**
   * 使用者實際可用的動作 = 角色給的 ∩ 公司被開通的。
   *
   * 交集而不是聯集，也不是只看角色：
   * 廠商可以自由設計自己的角色，但設計不出上層沒開通的功能。
   * 這是整套開通機制唯一真正生效的地方 —— 其餘都只是畫面。
   */
  public async resolveUserActions(companyId: number, roleActions: string[]): Promise<string[]> {
    const granted = new Set(await this.getGrantableActions(companyId));
    return roleActions.filter((a) => granted.has(a));
  }

  /** 子樹的公司 id（含自己）；所有跨公司查詢都收斂到這個範圍 */
  public async getSubtreeIds(companyId: number): Promise<number[]> {
    const rows = await this.companyRepo.query(
      `
      WITH RECURSIVE tree AS (
        SELECT id FROM companies WHERE id = $1
        UNION ALL
        SELECT c.id FROM companies c JOIN tree t ON c.parent_id = t.id
      )
      SELECT id FROM tree
      `,
      [companyId]
    );

    return rows.map((r: { id: number }) => Number(r.id));
  }

  /** 確認目標公司在自己的子樹裡；不在就當作不存在 */
  private async assertInSubtree(companyId: number, targetId: number): Promise<Company> {
    const ids = await this.getSubtreeIds(companyId);

    // 回 404 而不是 403：告訴對方「有這個公司但你不能碰」，
    // 本身就洩漏了它的存在 —— 而廠商不該知道平台或別的廠商存在
    if (!ids.includes(targetId)) throw new NotFoundException(`找不到公司：${targetId}`);

    const target = await this.companyRepo.findOne({ where: { id: targetId }, relations: { parent: true } });
    if (!target) throw new NotFoundException(`找不到公司：${targetId}`);

    return target;
  }

  /** 下層單位清單（不含自己） */
  public async listSubCompanies(dto: SubCompanyQueryDto, user: AuthUser): Promise<HttpResult> {
    const ids = (await this.getSubtreeIds(user.companyId)).filter((id) => id !== user.companyId);
    if (!ids.length) return HttpResponse.warn({ data: [], message: '底下沒有單位' });

    const qb = this.companyRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.parent', 'p')
      .loadRelationCountAndMap('c.userCount', 'c.users')
      .where('c.id IN (:...ids)', { ids })
      .orderBy('c.tier', 'ASC')
      .addOrderBy('c.code', 'ASC');

    if (dto.KEYWORD) qb.andWhere('(c.code ILIKE :kw OR c.name ILIKE :kw)', { kw: `%${dto.KEYWORD}%` });
    if (dto.TIER) qb.andWhere('c.tier = :tier', { tier: dto.TIER });
    if (dto.ACTIVE !== undefined) qb.andWhere('c.is_active = :active', { active: dto.ACTIVE });

    const rows = await qb.getMany();

    const grantCounts = await this.grantRepo
      .createQueryBuilder('g')
      .select('g.company_id', 'companyId')
      .addSelect('COUNT(*)::int', 'count')
      .where('g.company_id IN (:...ids)', { ids })
      .andWhere('g.is_active = true')
      .groupBy('g.company_id')
      .getRawMany<{ companyId: number; count: number }>();

    const byCompany = new Map(grantCounts.map((g) => [Number(g.companyId), g.count]));

    return HttpResponse.successOrWarn({
      data: rows.map((c) => ({
        ID: c.id,
        CODE: c.code,
        NAME: c.name,
        TIER: c.tier,
        TIER_NAME: TIER_NAME[c.tier] ?? String(c.tier),
        // 上層只顯示在子樹內；查詢已經收斂過，這裡不會露出平台
        PARENT_ID: c.parent?.id ?? null,
        PARENT_NAME: c.parent?.id === user.companyId ? c.parent?.name : (c.parent?.name ?? null),
        USER_LIMIT: c.userLimit,
        USER_COUNT: (c as Company & { userCount?: number }).userCount ?? 0,
        GRANT_COUNT: byCompany.get(c.id) ?? 0,
        IS_ACTIVE: c.isActive,
        DESCRIPTION: c.description ?? null,
        CREATED_AT: c.createdAt
      }))
    });
  }

  /**
   * 建立下層單位。
   *
   * 只能建「比自己低一層」的：平台建廠商、廠商建外包。
   * 外包不能再往下建 —— 三層是這個系統的責任邊界，
   * 再往下就沒有人為施工品質負責了。
   */
  public async createSubCompany(dto: CreateCompanyDto, user: AuthUser): Promise<HttpResult> {
    const parent = await this.companyRepo.findOne({ where: { id: user.companyId } });
    if (!parent) throw new NotFoundException('找不到目前公司');

    if (parent.tier >= COMPANY_TIER.SUBCONTRACTOR) {
      throw new ForbiddenException('外包單位不能再建立下層單位');
    }

    if (await this.companyRepo.exists({ where: { code: dto.CODE } })) {
      throw new BadRequestException(`公司代碼已存在：${dto.CODE}`);
    }

    const tier = (parent.tier + 1) as CompanyTier;

    // 開通的動作必須是自己有的子集；多開的直接擋下而不是默默忽略
    const grantable = new Set(await this.getGrantableActions(user.companyId));
    const requested = dto.ACTIONS ?? [];
    const excess = requested.filter((a) => !grantable.has(a));

    if (excess.length) throw new ForbiddenException(`無法開通自己沒有的權限：${excess.join(', ')}`);

    const saved = await this.dataSource.transaction(async (manager) => {
      const companyRepo = manager.getRepository(Company);

      const company = await companyRepo.save(
        companyRepo.create({
          code: dto.CODE,
          name: dto.NAME,
          parent: { id: parent.id },
          tier,
          userLimit: dto.USER_LIMIT ?? 10,
          description: dto.DESCRIPTION,
          isActive: true
        })
      );

      if (requested.length) {
        const grantRepo = manager.getRepository(CompanyGrant);
        await grantRepo.save(
          requested.map((actionKey) =>
            grantRepo.create({
              company: { id: company.id },
              actionKey,
              isActive: true,
              grantedByCompany: { id: parent.id },
              grantedBy: { id: user.uid }
            })
          )
        );
      }

      return company;
    });

    return HttpResponse.success({ message: '單位已建立', data: { ID: saved.id, CODE: saved.code, TIER: saved.tier } });
  }

  /** 更新下層單位的基本資料與額度 */
  public async updateSubCompany(dto: UpdateCompanyDto, user: AuthUser): Promise<HttpResult> {
    const target = await this.assertInSubtree(user.companyId, dto.ID);

    if (target.id === user.companyId) throw new ForbiddenException('不能修改自己的單位設定，請由上層單位處理');

    const patch: Partial<Company> = {};
    if (dto.NAME !== undefined) patch.name = dto.NAME;
    if (dto.USER_LIMIT !== undefined) patch.userLimit = dto.USER_LIMIT;
    if (dto.DESCRIPTION !== undefined) patch.description = dto.DESCRIPTION;
    if (dto.IS_ACTIVE !== undefined) patch.isActive = dto.IS_ACTIVE;

    if (!Object.keys(patch).length) throw new BadRequestException('沒有要更新的欄位');

    // 額度不能低於現有人數：直接砍到比現況小，等於讓已存在的帳號處於違規狀態，
    // 而系統又不會替你決定該停用誰
    if (patch.userLimit !== undefined) {
      const count = await this.userRepo.count({ where: { company: { id: target.id } } });
      if (patch.userLimit < count) throw new BadRequestException(`額度不可小於現有人數(${count})`);
    }

    await this.companyRepo.update({ id: target.id }, patch);

    return HttpResponse.success({ message: '單位已更新' });
  }

  /** 某個下層單位目前被開通了什麼；一併回傳「我能開通的範圍」給畫面用 */
  public async getGrants(companyId: number, user: AuthUser): Promise<HttpResult> {
    const target = await this.assertInSubtree(user.companyId, companyId);

    const [grants, grantable] = await Promise.all([
      this.grantRepo.find({ where: { company: { id: target.id } }, relations: { grantedByCompany: true, grantedBy: true } }),
      this.getGrantableActions(user.companyId)
    ]);

    return HttpResponse.success({
      data: {
        ID: target.id,
        CODE: target.code,
        NAME: target.name,
        TIER: target.tier,
        // 我能開通的上限；畫面用它決定哪些勾選框可以點
        GRANTABLE: grantable,
        GRANTS: grants.map((g) => ({
          ACTION_KEY: g.actionKey,
          IS_ACTIVE: g.isActive,
          GRANTED_BY_COMPANY: g.grantedByCompany?.name ?? null,
          GRANTED_BY: g.grantedBy?.name ?? null,
          UPDATED_AT: g.updatedAt
        }))
      }
    });
  }

  /**
   * 開通／收回下層單位的權限。
   *
   * 送進來的是「開通後應該有的完整清單」，不是增量 ——
   * 增量的介面在多人同時操作時會互相覆蓋，而且畫面上勾選的本來就是完整狀態。
   *
   * **收回會往下遞迴**：廠商被收回的權限，它已經開給外包的那份也要一起收 ——
   * 否則會出現「上層沒有、下層卻還有」的孤兒授權。
   */
  public async setGrants(dto: GrantActionsDto, user: AuthUser): Promise<HttpResult> {
    const target = await this.assertInSubtree(user.companyId, dto.COMPANY_ID);

    if (target.id === user.companyId) throw new ForbiddenException('不能開通自己的權限');

    const grantable = new Set(await this.getGrantableActions(user.companyId));
    const excess = dto.ACTIONS.filter((a) => !grantable.has(a));
    if (excess.length) throw new ForbiddenException(`無法開通自己沒有的權限：${excess.join(', ')}`);

    const next = new Set(dto.ACTIONS);

    const revoked = await this.dataSource.transaction(async (manager) => {
      const grantRepo = manager.getRepository(CompanyGrant);
      const existing = await grantRepo.find({ where: { company: { id: target.id } } });
      const existingKeys = new Set(existing.map((g) => g.actionKey));

      // 已存在的：切換啟用狀態，保留「當初誰開的」
      for (const g of existing) {
        const shouldBeActive = next.has(g.actionKey);
        if (g.isActive !== shouldBeActive) {
          await grantRepo.update({ id: g.id }, { isActive: shouldBeActive, grantedByCompany: { id: user.companyId }, grantedBy: { id: user.uid } });
        }
      }

      // 新開通的
      const added = [...next].filter((a) => !existingKeys.has(a));
      if (added.length) {
        await grantRepo.save(
          added.map((actionKey) =>
            grantRepo.create({
              company: { id: target.id },
              actionKey,
              isActive: true,
              grantedByCompany: { id: user.companyId },
              grantedBy: { id: user.uid }
            })
          )
        );
      }

      // 收回的要往下遞迴：留著孤兒授權，等於下層還能做上層已經沒有的事
      const removedKeys = existing.filter((g) => g.isActive && !next.has(g.actionKey)).map((g) => g.actionKey);
      if (!removedKeys.length) return 0;

      const descendants = (await this.getSubtreeIds(target.id)).filter((id) => id !== target.id);
      if (!descendants.length) return 0;

      const result = await grantRepo.update(
        { company: { id: In(descendants) }, actionKey: In(removedKeys), isActive: true },
        { isActive: false }
      );

      return result.affected ?? 0;
    });

    return HttpResponse.success({
      message: revoked ? `權限已更新；一併收回下層 ${revoked} 筆連帶授權` : '權限已更新',
      data: { CASCADED_REVOKES: revoked }
    });
  }

  /** 我這一層能開通的動作；建立與編輯下層單位的畫面用它畫勾選矩陣 */
  public async getGrantable(user: AuthUser): Promise<HttpResult> {
    const actions = await this.getGrantableActions(user.companyId);
    const company = await this.companyRepo.findOne({ where: { id: user.companyId } });

    return HttpResponse.success({
      data: {
        TIER: company?.tier ?? COMPANY_TIER.CONTRACTOR,
        TIER_NAME: TIER_NAME[company?.tier ?? COMPANY_TIER.CONTRACTOR],
        // 外包單位不能再往下開通，畫面用它決定要不要顯示「新增下層單位」
        CAN_CREATE_SUB: (company?.tier ?? COMPANY_TIER.SUBCONTRACTOR) < COMPANY_TIER.SUBCONTRACTOR,
        ACTIONS: actions
      }
    });
  }
}

const TIER_NAME: Record<number, string> = {
  [COMPANY_TIER.PLATFORM]: '平台管理',
  [COMPANY_TIER.CONTRACTOR]: '廠商單位',
  [COMPANY_TIER.SUBCONTRACTOR]: '外包單位'
};
