import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import { ACTION } from '@constants/module.const';
import { CreateRoleDto, UpdateRoleActionsDto } from './role.dto';

/** 系統允許的所有權限字串，用來擋掉打錯字的權限 */
const VALID_ACTIONS = new Set(Object.values(ACTION).flatMap((group) => Object.values(group)) as string[]);

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(User) private readonly userRepo: Repository<User>
  ) {}

  /** 權限總表：給前端的權限勾選畫面用，避免前端自己寫死一份會過期的清單 */
  public listActions(): HttpResult {
    return HttpResponse.success({
      data: Object.entries(ACTION).map(([feature, actions]) => ({
        FEATURE: feature,
        ACTIONS: Object.entries(actions).map(([name, key]) => ({ NAME: name, KEY: key }))
      }))
    });
  }

  /** 角色清單(含使用人數：要停用角色前得先知道會影響誰) */
  public async list(): Promise<HttpResult> {
    const roles = await this.roleRepo.find({ order: { id: 'ASC' } });

    const counts = await this.userRepo
      .createQueryBuilder('u')
      .select('u.role_id', 'roleId')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('u.role_id')
      .getRawMany<{ roleId: number; count: number }>();

    const byRole = new Map(counts.map((c) => [Number(c.roleId), c.count]));

    return HttpResponse.successOrWarn({
      data: roles.map((r) => ({ ID: r.id, KEY: r.key, NAME: r.name, ACTIONS: r.actions, USER_COUNT: byRole.get(r.id) ?? 0 }))
    });
  }

  /** 新增角色 */
  public async create(dto: CreateRoleDto): Promise<HttpResult> {
    if (await this.roleRepo.exists({ where: { key: dto.KEY } })) throw new ConflictException(`角色代號已存在：${dto.KEY}`);
    this.assertValidActions(dto.ACTIONS);

    const saved = await this.roleRepo.save(this.roleRepo.create({ key: dto.KEY, name: dto.NAME, actions: dto.ACTIONS }));
    return HttpResponse.success({ message: '角色已建立', data: { ID: saved.id } });
  }

  /**
   * 調整角色權限。
   *
   * 權限存在 JWT 裡，所以改完不會立刻生效 —— 要等使用者的 Token 過期重取。
   * 這是拿「每次請求不用查 DB」換來的，回應裡直接把延遲說清楚，
   * 免得管理員以為改了沒用而重複操作。
   */
  public async updateActions(dto: UpdateRoleActionsDto): Promise<HttpResult> {
    this.assertValidActions(dto.ACTIONS);

    const role = await this.roleRepo.findOneBy({ id: dto.ID });
    if (!role) throw new NotFoundException(`找不到角色：${dto.ID}`);

    await this.roleRepo.update(role.id, { actions: dto.ACTIONS });

    return HttpResponse.success({ message: '權限已更新，使用者需重新登入或等 Token 更新後生效' });
  }

  private assertValidActions(actions: string[]): void {
    const unknown = actions.filter((a) => !VALID_ACTIONS.has(a));
    if (unknown.length) throw new BadRequestException(`未知的權限：${unknown.join(', ')}`);
  }
}
