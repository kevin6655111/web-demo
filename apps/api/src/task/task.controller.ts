import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RedisService } from '@/redis/redis.service';
import { CLIENT_EVENT_BUS } from '@/queue/queue.const';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { TASK_TRIGGER_EVENT } from './task-events.controller';
import { TASK_STATUS_KEY } from './task-runner';
import { TriggerTaskDto } from './task.dto';
import { TASK_DEFS } from './task-definitions';

/**
 * 排程的對外介面(跑在 api 行程)。
 *
 * 這裡不執行任何排程 —— 狀態從 Redis 讀、觸發用事件送。
 * 這樣 api 可以有很多實例，而排程仍然只有一份在跑。
 */
@ApiTags('Task')
@ApiBearerAuth('bearer')
@Controller()
export class TaskController {
  constructor(
    private readonly redisService: RedisService,
    @Inject(CLIENT_EVENT_BUS) private readonly eventBus: ClientProxy
  ) {}

  /** 排程狀態 */
  @Get('task')
  @ApiOperation({
    summary: '排程狀態',
    description: [
      '列出所有排程的 cron、是否啟用、是否正在執行、上次完成時間。',
      '狀態由 scheduler 行程寫進 Redis，api 只負責讀 —— 因此 scheduler 沒起來時會回空陣列。',
      '',
      '所需權限：`TASK.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`data` 為排程列；scheduler 未啟動時為 `[]`' })
  @ApiCommonErrors()
  @RequireAction(ACTION.TASK.READ)
  async handleGetStatus(): Promise<HttpResult> {
    const status = await this.redisService.getJson<unknown[]>(TASK_STATUS_KEY);

    return HttpResponse.success({
      message: status ? '' : 'scheduler 尚未回報狀態',
      // 沒有狀態時回定義清單，讓畫面至少看得到有哪些排程存在
      data: status ?? Object.entries(TASK_DEFS).map(([key, def]) => ({ KEY: key, LABEL: def.label, CRON: def.cron, ENABLED: null }))
    });
  }

  /** 手動觸發排程 */
  @Post('task/trigger')
  @ApiOperation({
    summary: '手動觸發排程',
    description: [
      '送出觸發事件給 scheduler 行程，略過「是否啟用」的檢查執行一次，',
      '但仍受分散式鎖與逾時保護：正在跑的排程不會被重複觸發。',
      '',
      '這是非同步的 —— 回應只代表事件送出成功，執行結果請看排程狀態或 logs/task。',
      '',
      '所需權限：`TASK.RUN`'
    ].join('\n')
  })
  @ApiBody({
    type: TriggerTaskDto,
    examples: {
      geocoder: { summary: '補齊缺路名的案件', value: { KEY: 'addressGeocoder' } },
      warmup: { summary: '預熱圖層快取', value: { KEY: 'tilesWarmup' } },
      dashboard: { summary: '重算儀表板', value: { KEY: 'dashboardSync' } }
    }
  })
  @ApiResponse({ status: 201, description: '事件已送出' })
  @ApiCommonErrors({ badRequest: '參數錯誤: KEY 不在排程清單中' })
  @Audit({ action: 'TASK', keys: ['KEY'] })
  @RequireAction(ACTION.TASK.RUN)
  handleTrigger(@Body() dto: TriggerTaskDto, @User() user: AuthUser): HttpResult {
    this.eventBus.emit(TASK_TRIGGER_EVENT, { key: dto.KEY, account: user.account });
    return HttpResponse.success({ message: '已送出觸發事件，執行結果請查看排程狀態' });
  }
}
