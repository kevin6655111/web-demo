import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_META_KEY, type AuditMeta } from '@decorators/audit.decorator';
import { LogRecorderService } from '@/util/log-recorder.service';
import type { HttpRequest } from '@app-types/http.type';

/**
 * 稽核攔截器：只記 @Audit 標註過的 API，且只記標註的欄位。
 * 「白名單欄位」是刻意的——稽核日誌會長期保存，不該混進密碼或整包個資。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger;

  constructor(
    private readonly reflector: Reflector,
    private readonly logRecorderService: LogRecorderService
  ) {
    this.logger = this.logRecorderService.createLogger('audit-log');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_META_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<HttpRequest>();
    const start = Date.now();

    const source = { ...(req.body ?? {}), ...(req.query ?? {}) } as Record<string, unknown>;
    const picked = Object.fromEntries(meta.keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));

    const write = (outcome: 'OK' | 'FAIL') => {
      this.logger.info(
        JSON.stringify({
          action: meta.action,
          outcome,
          path: req.path,
          method: req.method,
          uid: req.user?.uid ?? null,
          account: req.user?.account ?? null,
          ip: req.ip,
          ms: Date.now() - start,
          fields: picked
        })
      );
    };

    return next.handle().pipe(tap({ next: () => write('OK'), error: () => write('FAIL') }));
  }
}
