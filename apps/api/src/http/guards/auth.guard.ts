import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthTokenService } from '@/util/auth-token.service';
import { ApiKeyService } from '@/auth/api-key.service';
import { ALLOW_API_KEY_META_KEY } from '@decorators/api-key.decorator';
import type { AuthUser } from '@app-types/user-auth.type';
import type { HttpRequest } from '@app-types/http.type';
import { UNPROTECTED_PATHS } from './unprotected-path';

/**
 * 全域憑證驗證：白名單以外的路徑都要帶有效憑證。
 *
 * 兩種憑證：
 *   JWT      人用的，cookie 或 Authorization 表頭
 *   API Key  機器用的，`X-Api-Key` 表頭 —— 只有標了 @AllowApiKey 的端點收
 *
 * 兩者都會變成同一個 `req.user`，後面的權限守衛不必知道差別。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 微服務事件不是 HTTP 請求：它沒有表頭、沒有 cookie，也沒有「使用者」可言。
    // 事件的來源是我們自己的行程，信任邊界在 Redis 那一層，不在這裡。
    // 不排除的話，全域守衛會把每一個事件都擋掉 —— 而且是安靜地擋掉。
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<HttpRequest>();
    const requestId = (req.headers['x-request-id'] as string) ?? 'ID';
    this.logger.log(`🌐 [${requestId}][${req.method}]: ${req.path}`);

    if (UNPROTECTED_PATHS.has(req.path)) return true;

    try {
      const apiKey = req.headers['x-api-key'];

      if (typeof apiKey === 'string' && apiKey) {
        // 沒標註的端點收到金鑰一律拒絕：金鑰外流時它能做的事要是有界的
        const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY_META_KEY, [
          context.getHandler(),
          context.getClass()
        ]);
        if (!allowed) throw new UnauthorizedException('此端點不接受 API Key');

        req.user = await this.apiKeyService.authenticate(apiKey);
        return true;
      }

      // Cookie 優先(瀏覽器)，其次 Authorization header(App 與對接系統)
      const token = req.cookies?.token ?? req.headers['authorization']?.split(' ')[1];
      if (!token) throw new UnauthorizedException('Authentication token missing');

      req.user = await this.authTokenService.jwtVerify<AuthUser>(token);
    } catch (error: any) {
      req.__audit = { action: 'AUTH', start: Date.now() };

      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(error?.message || 'Authentication failed');
    }

    return true;
  }
}
