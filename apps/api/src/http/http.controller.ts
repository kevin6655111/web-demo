import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from './http-response';
import { EnvService } from '@/env/env.service';

@Controller()
export class HttpController {
  constructor(private readonly envService: EnvService) {}

  /** 健康檢查：docker healthcheck 與 nginx 都靠這支判斷後端是否就緒 */
  @Get('health')
  @ApiExcludeEndpoint()
  handleHealth(): HttpResult {
    return HttpResponse.success({
      data: {
        name: this.envService.getAppConfig().name,
        env: this.envService.getNodeEnv(),
        uptimeSec: Math.round(process.uptime())
      }
    });
  }
}
