import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { RoleService } from './role.service';
import { CreateRoleDto, UpdateRoleActionsDto } from './role.dto';

@ApiTags('Role')
@ApiBearerAuth('bearer')
@Controller()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  /** 權限總表 */
  @Get('auth/action')
  @ApiOperation({
    summary: '系統權限總表',
    description: [
      '依功能分組列出所有權限字串，供權限勾選畫面使用。',
      '前端不要自己維護一份清單 —— 那份一定會過期。',
      '',
      '所需權限：`ACCOUNT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  handleListActions(): HttpResult {
    return this.roleService.listActions();
  }

  /** 角色清單 */
  @Get('auth/role')
  @ApiOperation({
    summary: '角色清單',
    description: ['一併回傳每個角色的使用人數 —— 調整權限前要先知道會影響誰。', '', '所需權限：`ACCOUNT.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  async handleList(): Promise<HttpResult> {
    return await this.roleService.list();
  }

  /** 新增角色 */
  @Post('auth/role')
  @ApiOperation({
    summary: '新增角色',
    description: ['`ACTIONS` 必須全部來自權限總表，有未知權限會整批拒絕(避免打錯字造成的無聲失效)。', '', '所需權限：`ACCOUNT.CREATE`'].join('\n')
  })
  @ApiBody({
    type: CreateRoleDto,
    examples: {
      supervisor: { summary: '工地主任(可驗收)', value: { KEY: 'SUPERVISOR', NAME: '工地主任', ACTIONS: ['CASE.READ', 'WORK_ORDER.READ', 'WORK_ORDER.ACCEPT'] } }
    }
  })
  @ApiResponse({ status: 201, description: '角色已建立' })
  @ApiCommonErrors({ badRequest: '參數錯誤: 含未知的權限字串', conflict: '角色代號已存在' })
  @Audit({ action: 'ROLE', keys: ['KEY', 'NAME'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.CREATE)
  async handleCreate(@Body() dto: CreateRoleDto): Promise<HttpResult> {
    return await this.roleService.create(dto);
  }

  /** 調整角色權限 */
  @Put('auth/role/action')
  @ApiOperation({
    summary: '調整角色權限',
    description: [
      '整批覆寫該角色的權限。',
      '',
      '**不會立即生效** —— 權限存在 JWT 內，要等使用者的 token 過期重取(預設 30 分鐘)。',
      '這是拿「每次請求不用查資料庫」換來的；回應會直接把這個延遲說清楚。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpdateRoleActionsDto,
    examples: { readonly: { summary: '收回寫入權限', value: { ID: 3, ACTIONS: ['CASE.READ', 'WORK_ORDER.READ', 'DASHBOARD.READ'] } } }
  })
  @ApiResponse({ status: 200, description: '權限已更新' })
  @ApiCommonErrors({ badRequest: '參數錯誤: 含未知的權限字串', notFound: '找不到該角色' })
  @Audit({ action: 'ROLE', keys: ['ID'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleUpdateActions(@Body() dto: UpdateRoleActionsDto): Promise<HttpResult> {
    return await this.roleService.updateActions(dto);
  }
}
