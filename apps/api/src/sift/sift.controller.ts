import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { SiftService } from './sift.service';
import { JudgeCaseDto, ReviewCaseDto, SiftQueryDto, SiftSalaryQueryDto, SiftStatsQueryDto } from './sift.dto';

@ApiTags('Sift')
@ApiBearerAuth(API_AUTH)
@Controller()
export class SiftController {
  constructor(private readonly siftService: SiftService) {}

  /** 二篩清單 */
  @Get('sift/case')
  @ApiOperation({
    summary: '二篩案件清單',
    description: [
      'AI 判讀出來的案件要先經人工確認才算數。`TYPE` 決定看誰的結果：',
      '',
      '- `GENERAL` 判讀員看還沒判的(未審、待審)',
      '- `MANAGE` 管理者看已經判過的，準備覆核',
      '',
      '排序是**舊的先判**：判讀有時效，越久沒判的案件越可能已經被修掉或惡化。',
      '每一列都附原圖與 AI 標註圖的短效網址，判讀時兩張要能點開比對。',
      '',
      '所需權限：`SIFT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SIFT.READ)
  async handleList(@Query() dto: SiftQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.siftService.list(dto, user.companyId);
  }

  /** 判定 */
  @Put('sift/judge')
  @ApiOperation({
    summary: '二篩判定(判讀員)',
    description: [
      '批次判定：`1` 通過 / `3` 刪除 / `4` 誤判。二篩是一批一批做的，逐筆送五十次沒有人會做。',
      '',
      '**擋下的情況**（該筆跳過並附原因，其餘照常）：',
      '- 已開立派工單 —— 派工是根據二篩通過來的，事後改會讓施工中的單失去依據',
      '- 已經管理者覆核 —— 判讀員不可再更改',
      '- 已判定過 —— 請走覆核端點',
      '',
      '有任何一筆被跳過時回應是 warn，訊息以換行分列各筆原因。',
      '',
      '所需權限：`SIFT.JUDGE`'
    ].join('\n')
  })
  @ApiBody({
    type: JudgeCaseDto,
    examples: {
      pass: { summary: '整批通過', value: { IDS: [12, 13, 14], STATUS: 1 } },
      misjudge: { summary: '誤判', value: { IDS: [15], STATUS: 4, REMARK: '路面反光' } }
    }
  })
  @ApiResponse({ status: 200, description: '已判定；`data.SKIPPED` 列出被跳過的案件與原因' })
  @ApiCommonErrors({ badRequest: '未指定案件' })
  @Audit({ action: 'SIFT', keys: ['IDS', 'STATUS'] })
  @RequireAction(ACTION.SIFT.JUDGE)
  async handleJudge(@Body() dto: JudgeCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.siftService.judge(dto, user);
  }

  /** 覆核 */
  @Put('sift/review')
  @ApiOperation({
    summary: '二篩覆核(管理者)',
    description: [
      '管理者對判讀員的結果做第二層確認，可以維持也可以推翻。覆核紀錄另外記一組時間與人，',
      '不會被判讀員的後續操作蓋掉 —— 薪資與品質統計都要看「誰判的、後來被推翻了沒有」。',
      '',
      '尚未經判讀員判定的案件不可覆核：那是判定而不是覆核。',
      '',
      '所需權限：`SIFT.REVIEW`'
    ].join('\n')
  })
  @ApiBody({
    type: ReviewCaseDto,
    examples: { overturn: { summary: '推翻為誤判', value: { IDS: [12], STATUS: 4, REMARK: '複查為既有補綻' } } }
  })
  @ApiResponse({ status: 200, description: '已覆核' })
  @ApiCommonErrors({ badRequest: '未指定案件' })
  @Audit({ action: 'SIFT', keys: ['IDS', 'STATUS'] })
  @RequireAction(ACTION.SIFT.REVIEW)
  async handleReview(@Body() dto: ReviewCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.siftService.review(dto, user);
  }

  /** 統計 */
  @Get('sift/stats')
  @ApiOperation({
    summary: '二篩統計',
    description: [
      '依判讀員、日期、行政區或破壞類型分組，回傳判定量、通過率、被覆核率。',
      '',
      '`PASS_RATE` 是品質指標：一個人如果什麼都判通過，這個數字會接近 100% ——',
      '搭配薪資表的 `ACCURACY`(沒被推翻的比例)一起看才有意義。',
      '',
      '所需權限：`SIFT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SIFT.READ)
  async handleStats(@Query() dto: SiftStatsQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.siftService.stats(dto, user.companyId);
  }

  /** 薪資表 */
  @Get('sift/salary')
  @ApiOperation({
    summary: '二篩人員薪資表',
    description: [
      '判定一件計一筆單價；被管理者覆核為誤判的，扣一筆錯誤價。單價寫在站台設定裡。',
      '',
      '**扣款高於單價是刻意的**：亂按通過比不按更糟 —— 錯的案件會被派工，',
      '現場的人白跑一趟，那個成本遠高於一件判讀的單價。',
      '',
      '只算判讀員的量，管理者的覆核不計價。',
      '',
      '所需權限：`SIFT.MANAGE`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ badRequest: 'MONTH 格式應為 YYYY-MM' })
  @RequireAction(ACTION.SIFT.MANAGE)
  async handleSalary(@Query() dto: SiftSalaryQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.siftService.salary(dto, user.companyId);
  }
}
