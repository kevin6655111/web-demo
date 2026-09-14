import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { HttpRequest } from '@app-types/http.type';

export const ACTION_BY_FIELD_KEY = 'action_by_field';

export type ActionByFieldMeta = { field: string; map: Record<string, string> };

/**
 * 依請求內容決定需要的權限。
 *
 * 同一支端點在不同的 `STATUS` 下，重量差很多：
 * 「回報進度」是施工人員的日常，但「完工」「撤回」「刪除」會改變已經回報過的事實。
 * 拆成四支端點的話，前端要記四個路徑，而它們的請求主體完全一樣。
 *
 * 所以權限跟著欄位值走 —— 對照表列在端點上，看得到「哪個值需要哪個權限」。
 * 對照表沒列到的值一律放行給 `@RequireAction` 標的基本權限處理，
 * 因為那些是這支端點的常態操作。
 */
@Injectable()
export class ActionByFieldGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 微服務事件沒有使用者，權限比對無從談起
    if (context.getType() !== 'http') return true;

    const meta = this.reflector.get<ActionByFieldMeta | undefined>(ACTION_BY_FIELD_KEY, context.getHandler());
    if (!meta) return true;

    const req = context.switchToHttp().getRequest<HttpRequest>();
    const value = (req.body as Record<string, unknown>)?.[meta.field];
    if (value === undefined || value === null) return true;

    const required = meta.map[String(value)];
    if (!required) return true;

    const owned = new Set(req.user?.actions ?? []);
    if (!owned.has(required)) throw new ForbiddenException(`權限不足：${meta.field}=${value} 需要 ${required}`);

    return true;
  }
}

/** 依欄位值要求權限；與 @RequireAction 併用，兩者都要通過 */
export const RequireActionByField = (field: string, map: Record<string, string>) =>
  applyDecorators(SetMetadata(ACTION_BY_FIELD_KEY, { field, map }), UseGuards(ActionByFieldGuard));
