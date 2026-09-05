import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthTokenService } from '@/util/auth-token.service';
import type { AuthUser } from '@app-types/user-auth.type';
import type { HttpRequest } from '@app-types/http.type';
import { UNPROTECTED_PATHS } from './unprotected-path';

/** 全域 Token 驗證：白名單以外的路徑都要帶有效 JWT */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('Auth');

  constructor(private readonly authTokenService: AuthTokenService) {}

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
