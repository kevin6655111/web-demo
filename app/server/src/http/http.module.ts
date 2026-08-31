import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpController } from './http.controller';
import { AuthGuard } from './guards/auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { AuditInterceptor } from './guards/audit.interceptor';
import { IdempotencyInterceptor } from './guards/idempotency.interceptor';
import { HttpExceptionFilter } from './guards/http-exception.filter';

/**
 * HTTP 層的橫切關注點全部掛在這裡：
 * 守衛順序是 AuthGuard → PermissionGuard(先確認是誰，才問能不能做)。
 */
@Module({
  controllers: [HttpController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 冪等要包在稽核外層：回放的請求不該再寫一筆「執行過」的稽核紀錄
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter }
  ]
})
export class HttpModule {}
