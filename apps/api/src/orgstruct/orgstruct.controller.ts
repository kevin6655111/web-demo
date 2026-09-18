import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { OrgstructService } from './orgstruct.service';

@ApiTags('Orgstruct')
@ApiBearerAuth(API_AUTH)
@Controller()
export class OrgstructController {
  constructor(private readonly orgstructService: OrgstructService) {}

  /** 使用者導覽 */
  @Get('auth/user/nav')
  @ApiOperation({
    summary: '使用者導覽選單',
    description: [
      '回傳這個使用者看得到的模組與子功能，已依權限過濾。',
      '',
      '**側邊欄不是寫死在前端的** —— 不同站台開的功能不一樣，',
      '寫死的話每個站台都要各自維護一份 build。',
      '整個模組都沒有可用功能時會被丟掉：點進去什麼都沒有比不顯示更糟。',
      '',
      '`COMPONENT` 是前端元件名，由前端的對照表決定實際載入哪一支。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  async handleGetNav(@User() user: AuthUser): Promise<HttpResult> {
    return await this.orgstructService.getUserNav(user);
  }
}
