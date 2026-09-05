import type { DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

type SecuritySchemeObject = Parameters<DocumentBuilder['addBearerAuth']>[0];

/**
 * 只保留有寫 @ApiOperation({ summary }) 的 endpoint。
 *
 * 文件採 opt-in：沒整理過說明的端點不會列出，不必逐支標 @ApiExcludeEndpoint()。
 * 一併移除沒有任何端點留下來的 tag，否則文件會出現空的分類區塊。
 */
export const keepDocumented = (document: OpenAPIObject): OpenAPIObject => {
  const paths: OpenAPIObject['paths'] = {};
  const usedTags = new Set<string>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const operations = Object.entries(pathItem).filter(([, op]) => (op as any)?.summary);
    if (!operations.length) continue;

    paths[path] = Object.fromEntries(operations);
    operations.forEach(([, op]) => ((op as any).tags as string[] | undefined)?.forEach((tag) => usedTags.add(tag)));
  }

  const tags = document.tags?.filter((tag) => usedTags.has(tag.name));

  return { ...document, paths, ...(tags ? { tags } : {}) };
};

/** 全站共用的 security scheme 名稱，需與 controller 上的 @ApiBearerAuth() 一致 */
export const API_AUTH = 'bearer';

/** Bearer (JWT) 認證設定，顯示於文件的認證區塊與各端點的認證需求 */
export const API_AUTH_SCHEME: SecuritySchemeObject = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  in: 'header',
  name: 'Authorization',
  description: 'JWT 為登入後取得的 token，內含帳號身分與權限；瀏覽器亦可改用登入時寫入的 httpOnly cookie'
};

/** 文件最上方的整體說明 */
export const API_DESCRIPTION = [
  '道路巡查 Demo 的內部介面文件。',
  '',
  '### 回應格式',
  '',
  '所有端點都回傳同一個信封：',
  '',
  '```json',
  '{ "status": true, "code": 200, "message": "", "data": {} }',
  '```',
  '',
  '`status` 為 false 代表「查無資料」或業務層的警告，HTTP 狀態碼仍可能是 200；',
  '真正的錯誤會以對應的 HTTP 狀態碼回傳，`data` 不存在。',
  '',
  '### 冪等性',
  '',
  '標示 `Idempotency-Key` 表頭的端點支援去重：同一把 key 重送會回放第一次的結果，',
  '不會重複建立資料。上游車機在收不到回應時的自動重送就是靠這個機制。',
  '',
  '### 權限',
  '',
  '每支端點所需的權限寫在說明的「所需權限」一行，權限總表見 `GET /api/auth/action`。'
].join('\n');
