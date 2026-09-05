import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/**
 * 全站統一的錯誤回應。
 *
 * - 400: ValidationPipe (whitelist + forbidNonWhitelisted)
 * - 401: AuthGuard (APP_GUARD)
 * - 403: PermissionGuard (APP_GUARD)
 * - 429: ThrottlerGuard (APP_GUARD)
 *
 * @param options.badRequest 覆寫 400 的說明
 * @param options.forbidden  覆寫 403 的說明(除了「權限不足」還有別的擋下理由時)
 * @param options.conflict   有 409 情境時補上說明(冪等衝突、重複資料)
 * @param options.notFound   有 404 情境時補上說明
 */
export const ApiCommonErrors = (options: { badRequest?: string; forbidden?: string; conflict?: string; notFound?: string } = {}) =>
  applyDecorators(
    ApiResponse({ status: 400, description: options.badRequest ?? '參數錯誤: 欄位缺漏、型別錯誤，或傳入未定義的欄位' }),
    ApiResponse({ status: 401, description: '未認證: token 缺漏、格式錯誤或已失效' }),
    ApiResponse({ status: 403, description: options.forbidden ?? '權限不足: 帳號未具備此操作所需的權限' }),
    ...(options.notFound ? [ApiResponse({ status: 404, description: options.notFound })] : []),
    ...(options.conflict ? [ApiResponse({ status: 409, description: options.conflict })] : []),
    ApiResponse({ status: 429, description: '請求過於頻繁: 已觸發流量限制，請稍後再試' })
  );
