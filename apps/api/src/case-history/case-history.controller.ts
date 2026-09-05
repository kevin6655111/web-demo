import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { CaseHistoryService } from './case-history.service';
import { AuditQueryDto, CompareVersionDto, RestoreCaseDto } from './case-history.dto';
import type { CaseType } from './entities/case-history.entity';

/**
 * 歷程 API。
 *
 * 破壞案件、巡查單、派工單、標案、檢測案件共用同一組端點 ——
 * 版本化的規則對五者是一樣的，拆成五套只是同樣的邏輯抄五遍。
 */
@ApiTags('History')
@ApiBearerAuth(API_AUTH)
@Controller('history')
export class CaseHistoryController {
  constructor(private readonly caseHistoryService: CaseHistoryService) {}

  /** 稽核查詢 */
  @Get('audit')
  @ApiOperation({
    summary: '稽核查詢：某段期間誰改了什麼',
    description: [
      '跨實體查詢變更紀錄，最多回 300 筆（新到舊）。',
      '',
      '這是稽核最常問的問題 —— 「上週誰把這些案件關掉的」。',
      '一張表記所有類型的歷程就是為了這個查詢：分表的話每次都要 union 五張。',
      '',
      '所需權限：`SYSTEM.AUDIT`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleAudit(@Query() dto: AuditQueryDto): Promise<HttpResult> {
    return await this.caseHistoryService.audit({
      caseType: dto.CASE_TYPE as CaseType | undefined,
      operatorId: dto.OPERATOR_ID,
      from: dto.DATE_FROM,
      to: dto.DATE_TO
    });
  }

  /** 版本時間軸 */
  @Get(':CASE_TYPE/:ID')
  @ApiOperation({
    summary: '版本時間軸',
    description: [
      '依版本正序回傳，讀起來就是一條時間軸。每筆含：',
      '',
      '- `ACTION` 這次做了什麼（建立／狀態變更／派工／還原…）',
      '- `CHANGES` 動了哪些欄位（`{ 欄位: { from, to } }`）',
      '- `SNAPSHOT` 該版本的完整樣貌',
      '- `FROM_STATE` / `TO_STATE` 狀態流轉',
      '- `SOURCE` 來源：人工／排程／worker／車機',
      '- `MODIFIED_BY`、`MODIFIED_AT`、`CLIENT_IP`',
      '',
      '**歷程只增不改**：把狀態改回去也是一筆新版本，不會蓋掉舊的 ——',
      '否則「改錯又改回來」在紀錄上會完全看不出來。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'CASE_TYPE', enum: ['CASE_PATROL', 'WORK_ORDER', 'PROJECT', 'SURVEY'], example: 'CASE_PATROL' })
  @ApiParam({ name: 'ID', example: 12 })
  @ApiResponse({ status: 200, description: '查詢成功；無歷程時 `status` 為 false' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetHistory(@Param('CASE_TYPE') caseType: CaseType, @Param('ID', ParseIntPipe) id: number): Promise<HttpResult> {
    return await this.caseHistoryService.getHistory(caseType, id);
  }

  /** 指定版本 */
  @Get(':CASE_TYPE/:ID/version/:VERSION')
  @ApiOperation({
    summary: '取得指定版本的完整樣貌',
    description: ['回傳該版本的完整快照，可直接拿來比對或預覽還原結果。', '', '所需權限：`CASE.READ`'].join('\n')
  })
  @ApiParam({ name: 'CASE_TYPE', example: 'CASE_PATROL' })
  @ApiParam({ name: 'ID', example: 12 })
  @ApiParam({ name: 'VERSION', example: 3 })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到指定版本' })
  @RequireAction(ACTION.CASE.READ)
  async handleGetVersion(
    @Param('CASE_TYPE') caseType: CaseType,
    @Param('ID', ParseIntPipe) id: number,
    @Param('VERSION', ParseIntPipe) version: number
  ): Promise<HttpResult> {
    return await this.caseHistoryService.getVersion(caseType, id, version);
  }

  /** 版本比較 */
  @Get(':CASE_TYPE/:ID/diff')
  @ApiOperation({
    summary: '比較兩個版本',
    description: [
      '回傳兩版之間的欄位差異，格式為 `{ 欄位: { from, to } }`。',
      '',
      '比較用字串而非型別比對：資料庫的 `numeric` 讀回來是 `"1.00"`，',
      '直接比會讓每次儲存都冒出一堆假的變更，真正的變更就淹在裡面。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'CASE_TYPE', example: 'CASE_PATROL' })
  @ApiParam({ name: 'ID', example: 12 })
  @ApiResponse({ status: 200, description: '比較成功' })
  @ApiCommonErrors({ notFound: '找不到指定版本' })
  @RequireAction(ACTION.CASE.READ)
  async handleCompare(
    @Param('CASE_TYPE') caseType: CaseType,
    @Param('ID', ParseIntPipe) id: number,
    @Query() dto: CompareVersionDto
  ): Promise<HttpResult> {
    return await this.caseHistoryService.compare(caseType, id, dto.FROM, dto.TO);
  }

  /** 還原 */
  @Post('restore')
  @ApiOperation({
    summary: '還原至指定版本',
    description: [
      '把內容改回該版本的樣子。分表（地址、狀態、取樣）會一起還原。',
      '',
      '**只還原人改得動的欄位** —— 座標、照片、外部系統 id、單號不還原：',
      '那些是「這筆資料是什麼」而不是「有人改過的內容」，',
      '還原成舊座標只會讓案件跑到地圖上的另一個位置。',
      '',
      '**不刪任何歷程**：還原自己也是一筆新版本，稽核看得到它發生過。',
      '',
      '檢測案件不支援還原（數值來自儀器，人工只標註不改值）。',
      '',
      '所需權限：`CASE.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: RestoreCaseDto,
    examples: {
      rollbackCase: { summary: '案件還原到派工前', value: { CASE_TYPE: 'CASE_PATROL', ID: 12, VERSION: 2 } },
      rollbackOrder: { summary: '派工單還原到改材料前', value: { CASE_TYPE: 'WORK_ORDER', ID: 3, VERSION: 1 } }
    }
  })
  @ApiResponse({ status: 201, description: '還原成功，回傳實際還原的欄位' })
  @ApiCommonErrors({ badRequest: '該類型不支援還原，或該版本沒有可還原的欄位', notFound: '找不到指定版本' })
  @Audit({ action: 'CASE', keys: ['CASE_TYPE', 'ID', 'VERSION'] })
  @RequireAction(ACTION.CASE.UPDATE)
  async handleRestore(@Body() dto: RestoreCaseDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.caseHistoryService.restore(dto.CASE_TYPE as CaseType, dto.ID, dto.VERSION, user.uid, req.ip);
  }
}
