import type { DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

type SecuritySchemeObject = Parameters<DocumentBuilder['addBearerAuth']>[0];

/**
 * 只保留有寫 `@ApiOperation({ summary })` 的端點。
 *
 * 文件採 opt-in：沒整理過說明的端點不會列出，不必逐支標 `@ApiExcludeEndpoint()`。
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

/**
 * 只保留掛在指定 tag 底下的端點。
 *
 * 用於「同一個 controller 的端點要分給不同對接單位」：`include` 只篩得到模組層級。
 * 細分靠 tag —— 它標在端點上，改路徑或搬方法都不會失效。
 *
 * 注意 `@ApiTags` 在 class 層與 method 層是**疊加而非覆蓋**：
 * 要分章節的 controller 不能在 class 層標 tag，否則每支都會同時屬於兩個 tag。
 */
export const pickByTag = (document: OpenAPIObject, tag: string): OpenAPIObject => {
  const paths: OpenAPIObject['paths'] = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const operations = Object.entries(pathItem).filter(([, op]) => (op as any)?.tags?.includes(tag));
    if (!operations.length) continue;

    paths[path] = Object.fromEntries(operations);
  }

  return { ...document, paths };
};

/**
 * 檢查文件裡每支端點都只掛一個 tag，而且屬於允許的清單。
 *
 * 為什麼要在**啟動時**擋下來：
 *
 * - tag 標錯既不報錯也不會少東西，文件照樣產得出來
 * - 某支多掛了別家的 tag，就會被 `pickByTag` 一併撈進別人的文件裡
 * - 這是資料外洩等級的錯誤，卻要逐支點開比對才看得出來
 *
 * 所以寧可讓服務啟動失敗，也不要默默把別家的介面發出去。
 *
 * @throws 任一端點的 tag 不合規即丟出
 */
export const assertTagsWithin = (document: OpenAPIObject, allowed: string[]): void => {
  const allowedTags = new Set(allowed);

  const offenders = Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      // pathItem 也可能有 parameters 這類非端點的鍵，以 summary 判定
      .filter(([, op]) => (op as any)?.summary)
      .map(([method, op]) => ({ method, tags: ((op as any).tags ?? []) as string[] }))
      .filter(({ tags }) => tags.length !== 1 || !allowedTags.has(tags[0]))
      .map(({ method, tags }) => `${method.toUpperCase()} ${path} → [${tags.join(', ') || '無 tag'}]`)
  );

  if (!offenders.length) return;

  throw new Error(
    `文件「${document.info.title}」的 tag 不乾淨(每支只能掛一個，且需屬於 ${allowed.join(' / ')}):\n  ${offenders.join('\n  ')}`
  );
};

/** 全站共用的 security scheme 名稱，需與 controller 上的 `@ApiBearerAuth()` 一致 */
export const API_AUTH = 'bearer';

/** 內部文件的 Bearer (JWT)：內部介面用的是登入後的使用者 token */
export const API_AUTH_SCHEME: SecuritySchemeObject = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  in: 'header',
  name: 'Authorization',
  description: 'JWT 為登入後取得的 token，內含帳號身分與權限；瀏覽器亦可改用登入時寫入的 httpOnly cookie'
};

/** X-Api-Key 的 security scheme 名稱，需與 controller 上的 `@ApiSecurity()` 一致 */
export const API_KEY_AUTH = 'api-key';

/** 對外文件的 X-Api-Key：與我方推送資料給對方時所用為同一把 */
export const API_KEY_AUTH_SCHEME: SecuritySchemeObject = {
  type: 'apiKey',
  in: 'header',
  name: 'X-Api-Key',
  description: '介接金鑰，由本方依對接單位核發；不同單位、不同環境的金鑰皆不相同'
};

/** 對外文件的認證方式；一個章節只用一種，混用會讓對方照文件做卻 401 */
export type AuthMode = 'bearer' | 'apiKey';

const AUTH_GUIDES: Record<AuthMode, string> = {
  bearer: [
    '### 認證方式',
    '',
    '本章節所有 API 皆需於 HTTP Header 帶入 Bearer Token：',
    '',
    '```',
    'Authorization: Bearer <你的金鑰>',
    '```',
    '',
    'Token 為 JWT，內含對接單位身分，由本方個別核發；不同單位、不同環境的金鑰皆不相同，請勿共用或轉發。',
    '',
    '金鑰與介接網域皆另行提供，未於本文件列出。'
  ].join('\n'),
  apiKey: [
    '### 認證方式',
    '',
    '本章節所有 API 皆需於 HTTP Header 帶入介接金鑰：',
    '',
    '```',
    'X-Api-Key: <你的金鑰>',
    '```',
    '',
    '金鑰由本方核發，可個別撤銷；不同環境（測試機／正式機）的金鑰不同，請勿共用或轉發。',
    '',
    '金鑰與介接網域皆另行提供，未於本文件列出。'
  ].join('\n')
};

/**
 * 組出章節說明：模組自己的介紹 + 該章節的認證說明。
 *
 * 認證方式要與該章節端點實際掛的守衛一致(`@AllowApiKey` ↔ apiKey，否則 bearer)——
 * 寫錯的話對方會照文件做然後拿到 401，而那通常要來回幾封信才查得出來。
 */
export const tagDescription = (first: string | { auth: AuthMode }, ...intro: string[]): string => {
  const auth: AuthMode = typeof first === 'string' ? 'bearer' : first.auth;
  const lines = typeof first === 'string' ? [first, ...intro] : intro;

  return [...lines, '', AUTH_GUIDES[auth]].join('\n');
};
