/**
 * 不需要 Token 的路徑。
 * 用白名單而非在 controller 上散落 @Public()，是為了「預設全部受保護」——
 * 新增 API 忘記標註時，結果是被擋下來，而不是裸奔。
 */
export const UNPROTECTED_PATHS = new Set<string>(['/api/health', '/api/user/authenticate']);
