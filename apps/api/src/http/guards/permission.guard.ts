import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_ACTION_META_KEY, type FeatureActionMeta } from '@decorators/permission.decorator';
import type { HttpRequest } from '@app-types/http.type';

/**
 * 功能權限守衛。
 * 沒標 @RequireAction 的 API 一律放行(只要通過 AuthGuard)，
 * 標了就逐一比對 JWT 裡的 actions —— 權限在登入時就算好，這裡不再查 DB。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 同 AuthGuard：微服務事件沒有使用者，權限比對無從談起
    if (context.getType() !== 'http') return true;

    const meta = this.reflector.getAllAndOverride<FeatureActionMeta | undefined>(FEATURE_ACTION_META_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!meta?.keys?.length) return true;

    const req = context.switchToHttp().getRequest<HttpRequest>();
    const owned = new Set(req.user?.actions ?? []);

    const lacking = meta.keys.filter((key) => !owned.has(key));
    if (lacking.length > 0) throw new ForbiddenException(`權限不足：需要 ${lacking.join(', ')}`);

    return true;
  }
}
