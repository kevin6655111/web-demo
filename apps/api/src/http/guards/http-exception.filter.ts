import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { HttpResponse } from '@/http/http-response';
import type { HttpRequest } from '@app-types/http.type';

/**
 * 全域例外過濾器：把任何拋出的錯誤轉成統一信封。
 * 前端因此永遠只需要看 status/code，不必分辨「這次是 Nest 的格式還是我們的格式」。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    // 這個過濾器同時掛在 HTTP 與微服務(Redis transport)上。
    // RPC 情境沒有 response 物件，硬套 HTTP 的回應方式會讓整個行程掛掉 ——
    // 事件本來就沒有「回應」可言，記錄下來就是全部能做的事。
    if (host.getType() !== 'http') {
      this.logger.error(`[RPC] 事件處理失敗`, exception instanceof Error ? exception.stack : undefined);
      return;
    }

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<HttpRequest>();

    const isHttp = exception instanceof HttpException;
    const code = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = isHttp ? exception.getResponse() : undefined;
    const message =
      typeof payload === 'string'
        ? payload
        : ((payload as any)?.message ?? (exception instanceof Error ? exception.message : 'Server error'));

    // 5xx 記完整堆疊，4xx 只記一行：預期內的錯不該淹沒日誌
    if (code >= 500)
      this.logger.error(
        `[${req.method}] ${req.path} → ${code}`,
        exception instanceof Error ? exception.stack : undefined
      );
    else
      this.logger.warn(
        `[${req.method}] ${req.path} → ${code} ${Array.isArray(message) ? message.join('; ') : message}`
      );

    res.status(code).json(HttpResponse.error({ code, message: Array.isArray(message) ? message.join('; ') : message }));
  }
}
