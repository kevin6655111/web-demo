import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { ProjectService } from './project.service';
import { CreateProjectDto, ProjectQueryDto, UpdateProjectStateDto, UpsertProjectRelationDto } from './project.dto';

@ApiTags('Project')
@ApiBearerAuth(API_AUTH)
@Controller()
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  /** 標案清單 */
  @Get('project')
  @ApiOperation({
    summary: '查詢標案',
    description: [
      '標案是整個系統的分區單位：案件、車輛、報表、驗收、請款都以標案為界。',
      '',
      '只列出**目前公司有參與**的標案 —— 透過公司關聯表判斷而不是標案上的欄位，',
      '因為一個標案常由主辦與協力廠商共同執行，兩邊都要看得到自己的案子。',
      '',
      '一併帶回案件數與派工率，承辦不必為了看進度再點進每一個標案。',
      '',
      '所需權限：`PROJECT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.PROJECT.READ)
  async handleList(@Query() dto: ProjectQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.projectService.list(dto, user.companyId);
  }

  /** 工務段清單 */
  @Get('project/section')
  @ApiOperation({
    summary: '工務段清單',
    description: ['查詢條件的下拉選單用。', '', '所需權限：`PROJECT.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.PROJECT.READ)
  async handleListSections(@User() user: AuthUser): Promise<HttpResult> {
    return await this.projectService.listSections(user.companyId);
  }

  /** 行政區清單 */
  @Get('project/area')
  @ApiOperation({
    summary: '行政區清單',
    description: ['縣市／行政區的連動下拉用；帶 `COUNTY` 只回該縣市的行政區。', '', '所需權限：`PROJECT.READ`'].join('\n')
  })
  @ApiQuery({ name: 'COUNTY', required: false, example: '臺中市' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.PROJECT.READ)
  async handleListAreas(@Query('COUNTY') county?: string): Promise<HttpResult> {
    return await this.projectService.listAreas(county);
  }

  /** 標案詳情 */
  @Get('project/:ID')
  @ApiOperation({
    summary: '標案詳情',
    description: ['含參與公司（主辦／協力）、配置車輛、工務段與其轄區。', '', '所需權限：`PROJECT.READ`'].join('\n')
  })
  @ApiParam({ name: 'ID', example: 1 })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到標案' })
  @RequireAction(ACTION.PROJECT.READ)
  async handleGetById(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.projectService.getById(id, user.companyId);
  }

  /** 新增標案 */
  @Post('project')
  @ApiOperation({
    summary: '新增標案',
    description: [
      '新標案預設為草稿（`DRAFT`），需改為執行中才會被案件自動編碼排程認列。',
      '',
      '建立時自動把目前公司掛為主辦 —— 少了這一步，建立者連自己剛建的標案都看不到。',
      '',
      '所需權限：`PROJECT.CREATE`'
    ].join('\n')
  })
  @ApiBody({
    type: CreateProjectDto,
    examples: {
      basic: {
        summary: '市區道路巡查標案',
        value: {
          PRJ_ID: 'DEMO02',
          PRJ_NO: '1160829-001',
          PRJ_NAME: '116 年度市區道路巡查',
          PRJ_MAIN: '116 年度市區道路巡查維護暨即時通報系統委外服務案',
          PROPRIETOR: '示範市政府建設局',
          PROPRIETOR_LEVEL: 2,
          START_DATE: '2027-01-01',
          END_DATE: '2027-12-31',
          BUDGET: 12000000,
          ROAD_KM: 320.5
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立' })
  @ApiCommonErrors({ conflict: '標案號已存在' })
  @Audit({ action: 'PROJECT', keys: ['PRJ_ID', 'PRJ_NAME', 'PROPRIETOR'] })
  @RequireAction(ACTION.PROJECT.CREATE)
  async handleCreate(@Body() dto: CreateProjectDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.projectService.create(dto, user.companyId);
  }

  /** 變更狀態 */
  @Put('project/state')
  @ApiOperation({ summary: '變更標案狀態', description: ['草稿 → 執行中 → 結案。', '', '所需權限：`PROJECT.UPDATE`'].join('\n') })
  @ApiBody({
    type: UpdateProjectStateDto,
    examples: { activate: { summary: '開始執行', value: { ID: 1, STATE: 'ACTIVE' } }, close: { summary: '結案', value: { ID: 1, STATE: 'CLOSED' } } }
  })
  @ApiResponse({ status: 200, description: '狀態已更新' })
  @ApiCommonErrors({ notFound: '找不到該標案' })
  @Audit({ action: 'PROJECT', keys: ['ID', 'STATE'] })
  @RequireAction(ACTION.PROJECT.UPDATE)
  async handleUpdateState(@Body() dto: UpdateProjectStateDto): Promise<HttpResult> {
    return await this.projectService.updateState(dto);
  }

  /** 維護關聯 */
  @Put('project/relation')
  @ApiOperation({
    summary: '維護標案關聯（公司／車輛／工務段轄區）',
    description: [
      '三種關聯共用一支端點：它們的形狀一樣（標案 + 對象 + 啟用與否），',
      '拆三支只是讓前端多記三個路徑。',
      '',
      '**停用而不是刪除**：換廠商、車輛調度、轄區調整都是常態，',
      '但去年的案件仍然要查得到「當時是誰在做、哪台車跑的」。',
      '刪掉關聯，舊資料的責任歸屬就消失了。',
      '',
      '所需權限：`PROJECT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpsertProjectRelationDto,
    examples: {
      company: { summary: '加入協力廠商', value: { PROJECT_ID: 1, KIND: 'COMPANY', TARGET_ID: 2, ROLE: 'SUB' } },
      vehicle: { summary: '配置巡查車', value: { PROJECT_ID: 1, KIND: 'VEHICLE', TARGET_ID: 3 } },
      section: { summary: '設定工務段轄區', value: { PROJECT_ID: 1, KIND: 'SECTION', TARGET_ID: 1, AREA_IDS: [1, 2] } },
      disable: { summary: '停用（保留歷史）', value: { PROJECT_ID: 1, KIND: 'VEHICLE', TARGET_ID: 3, IS_ACTIVE: false } }
    }
  })
  @ApiResponse({ status: 200, description: '關聯已更新' })
  @ApiCommonErrors({ notFound: '找不到標案' })
  @Audit({ action: 'PROJECT', keys: ['PROJECT_ID', 'KIND', 'TARGET_ID', 'IS_ACTIVE'] })
  @RequireAction(ACTION.PROJECT.UPDATE)
  async handleUpsertRelation(@Body() dto: UpsertProjectRelationDto): Promise<HttpResult> {
    return await this.projectService.upsertRelation(dto);
  }
}
