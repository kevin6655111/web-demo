import { ExecutionContext, Global, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoginGuardService } from './login-guard.service';

/**
 * 流量限制只對 HTTP 有意義。
 *
 * 微服務事件由自己的行程發出，對它限流等於在尖峰時自己丟掉自己的事件；
 * 而且 ThrottlerGuard 會去讀 request.ip —— 事件裡沒有那個東西。
 */
@Injectable()
export class HttpOnlyThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }
}

/**
 * 流量限制與登入保護。
 *
 * 三組限制，對應三種濫用方式：
 *   short   每秒 —— 擋自動化腳本的爆量
 *   medium  每分鐘 —— 擋一般的過度呼叫
 *   long    每小時 —— 擋緩慢但持續的資料抓取
 *
 * 車機批次上傳案件是正常流量，所以門檻不能太低；
 * 針對登入的嚴格限制寫在 controller 上(見 @Throttle)。
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },
      { name: 'medium', ttl: 60_000, limit: 300 },
      { name: 'long', ttl: 3_600_000, limit: 5000 }
    ])
  ],
  providers: [LoginGuardService, { provide: APP_GUARD, useClass: HttpOnlyThrottlerGuard }],
  exports: [LoginGuardService]
})
export class SecurityModule {}
