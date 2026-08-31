import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { CompanyTreeService } from './company-tree.service';
import { CreateCompanyDto, GrantActionsDto, SubCompanyQueryDto, UpdateCompanyDto } from './company-tree.dto';

/**
 * 下層單位管理。
 *
 * 平台管理下面的廠商單位，廠商再管理自己的外包單位 ——
 * 同一組端點服務兩層，因為規則完全一樣：只看得到自己的子樹、
 * 開不出自己沒有的權限。
 */
@ApiTags('Company')
@ApiBearerAuth(API_AUTH)
@Controller('company')
export class CompanyTreeController {
  constructor(private readonly companyTreeService: CompanyTreeService) {}

  /** 我能開通什麼 */
  @Get('grantable')
  @ApiOperation({
    summary: '我這一層能開通的權限',
    description: [
      '回傳目前公司的層級，以及**能往下開通的動作清單** —— 也就是自己被開通的那些。',
      '',
      '平台層沒有上層，所以上限是程式碼裡的完整動作表；',
      '否則系統剛裝好時沒有人開得出第一份授權。',
      '',
      '畫面用它決定權限矩陣哪些格子可以點：點得到卻開不成，是最糟的介面。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleGetGrantable(@User() user: AuthUser): Promise<HttpResult> {
    return await this.companyTreeService.getGrantable(user);
  }

  /** 下層單位清單 */
  @Get()
  @ApiOperation({
    summary: '下層單位清單',
    description: [
      '只列出**自己子樹底下**的單位 —— 廠商查不到平台，也查不到別的廠商。',
      '',
      '這不是畫面上的隱藏：查詢本身就以子樹收斂，直接打 API 也拿不到。',
      '所以廠商單位不會知道平台這個層級存在。',
      '',
      '一併帶回人員數與已開通的權限數，不必為了看用量再點進去。',
      '',
      '所需權限：`ACCOUNT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  async handleList(@Query() dto: SubCompanyQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.companyTreeService.listSubCompanies(dto, user);
  }

  /** 建立下層單位 */
  @Post()
  @ApiOperation({
    summary: '建立下層單位',
    description: [
      '只能建「比自己低一層」的：平台建廠商、廠商建外包。',
      '外包不能再往下建 —— 三層是這個系統的責任邊界。',
      '',
      '`ACTIONS` 是建立時一併開通的權限，**必須是自己有的子集**；',
      '多開的直接回 403 而不是默默忽略，否則建立者會以為開通成功了。',
      '',
      '所需權限：`ACCOUNT.CREATE`'
    ].join('\n')
  })
  @ApiBody({
    type: CreateCompanyDto,
    examples: {
      sub: {
        summary: '廠商建立外包單位',
        description: '只給施工回報需要的權限：看得到案件與派工單、能回報進度，但不能派工也不能驗收',
        value: {
          CODE: 'SUB01',
          NAME: '示範外包工程行',
          USER_LIMIT: 10,
          DESCRIPTION: '負責西屯區道路修繕',
          ACTIONS: ['CASE.READ', 'WORK_ORDER.READ', 'WORK_ORDER.UPDATE', 'DASHBOARD.READ']
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立' })
  @ApiCommonErrors({ badRequest: '公司代碼已存在', forbidden: '外包單位不能再建下層，或開通了自己沒有的權限' })
  @Audit({ action: 'ACCOUNT', keys: ['CODE', 'NAME', 'USER_LIMIT'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.CREATE)
  async handleCreate(@Body() dto: CreateCompanyDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.companyTreeService.createSubCompany(dto, user);
  }

  /** 更新下層單位 */
  @Put()
  @ApiOperation({
    summary: '更新下層單位',
    description: [
      '名稱、人員額度、描述、啟用狀態。',
      '',
      '額度不可低於現有人數 —— 直接砍到比現況小，等於讓已存在的帳號處於違規狀態，',
      '而系統又不會替你決定該停用誰。',
      '',
      '停用而不刪除：合約中止後仍要查得到當時的案件是誰做的。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '額度小於現有人數，或沒有帶要更新的欄位', notFound: '該單位不在你的管理範圍內' })
  @Audit({ action: 'ACCOUNT', keys: ['ID', 'NAME', 'USER_LIMIT', 'IS_ACTIVE'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleUpdate(@Body() dto: UpdateCompanyDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.companyTreeService.updateSubCompany(dto, user);
  }

  /** 某單位的授權明細 */
  @Get(':ID/grant')
  @ApiOperation({
    summary: '下層單位的授權明細',
    description: [
      '回傳該單位目前被開通的動作（含是誰、哪個單位開的），',
      '以及**我能開通的範圍** —— 畫面用後者決定哪些格子可以點。',
      '',
      '所需權限：`ACCOUNT.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'ID', example: 3 })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '該單位不在你的管理範圍內' })
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  async handleGetGrants(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.companyTreeService.getGrants(id, user);
  }

  /** 開通／收回權限 */
  @Put('grant')
  @ApiOperation({
    summary: '開通／收回下層單位的權限',
    description: [
      '送進來的是「開通後應該有的**完整**清單」，不是增量 ——',
      '增量的介面在多人同時操作時會互相覆蓋，而且畫面上勾選的本來就是完整狀態。',
      '',
      '**收回會往下遞迴**：廠商被收回的權限，它已經開給外包的那份也一起收，',
      '否則會出現「上層沒有、下層卻還有」的孤兒授權。回應會告訴你連帶收回了幾筆。',
      '',
      '開通只是「上限」—— 使用者實際能做什麼，是角色給的動作與這份清單的交集。',
      '少了交集這一步，廠商自己建一個全權限角色就繞過了開通機制。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: GrantActionsDto,
    examples: {
      grant: { summary: '開通施工回報', value: { COMPANY_ID: 3, ACTIONS: ['CASE.READ', 'WORK_ORDER.READ', 'WORK_ORDER.UPDATE'] } },
      revoke: { summary: '收回到只剩檢視', value: { COMPANY_ID: 3, ACTIONS: ['CASE.READ'] } }
    }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ forbidden: '開通了自己沒有的權限，或試圖開通自己', notFound: '該單位不在你的管理範圍內' })
  @Audit({ action: 'ACCOUNT', keys: ['COMPANY_ID', 'ACTIONS'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleSetGrants(@Body() dto: GrantActionsDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.companyTreeService.setGrants(dto, user);
  }
}
