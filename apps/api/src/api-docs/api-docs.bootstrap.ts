import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { safeEqual } from '@/util/app-crypto';
import { EnvService } from '@/env/env.service';
import { INTERNAL_API_DESCRIPTION, INTERNAL_DOC_MODULES, INTERNAL_DOC_TAGS, VENDOR_DOCS } from './api-docs.const';
import {
  API_AUTH,
  API_AUTH_SCHEME,
  API_KEY_AUTH,
  API_KEY_AUTH_SCHEME,
  assertTagsWithin,
  keepDocumented,
  pickByTag
} from './swagger.helper';

/** 金鑰最短長度；未達此長度視為未設定，該文件一律回 503 */
const MIN_KEY_LENGTH = 10;

/** 通過後種下的 cookie 有效時間：一個工作天夠用，過期就重新帶連結 */
const COOKIE_MAX_AGE_MS = 8 * 60 * 60_000;

type GuardedDocOptions = {
  /** 文件路徑，例如 `internal-docs` 或 `api-docs/device` */
  path: string;
  document: OpenAPIObject;
  title: string;
  accessKey?: string;
};

/**
 * 取出對方帶來的金鑰。
 *
 * 三個來源各有用途：
 *   `?k=`          給人點連結用
 *   `X-Docs-Key`   給程式抓 spec 用
 *   cookie         給文件頁載入後抓 spec 用 —— swagger-ui 是用相對路徑去抓的，
 *                  瀏覽器不會幫它把網址上的 `?k=` 帶過去
 */
const presentedKey = (req: Request, cookieName: string): string => {
  const fromQuery = req.query?.k;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

  const fromHeader = req.headers['x-docs-key'];
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader;

  const fromCookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[cookieName];
  return typeof fromCookie === 'string' ? fromCookie : '';
};

/**
 * 掛上一份需要金鑰的文件。
 *
 * **每份文件各自一把金鑰，所以可以個別撤銷**：某一單位的連結外流時只換那一把，
 * 不必通知所有對接單位換金鑰。
 *
 * 守衛只擋兩條路徑：文件頁本身與 spec JSON。
 * swagger-ui 的靜態檔(bundle、字型)不擋 —— 那些是公開的第三方檔案，
 * 而擋住它們會讓文件頁載不出來，因為瀏覽器抓靜態檔時不會帶金鑰。
 */
export function setupGuardedDoc(app: NestExpressApplication, options: GuardedDocOptions): void {
  const logger = new Logger('ApiDocs');

  const { path, document, title, accessKey } = options;
  const docPath = path.startsWith('/') ? path : `/${path}`;
  const specPath = `${docPath}-json`;
  const cookieName = `docs_${path.replace(/[^a-z0-9]/gi, '_')}`;

  const usable = !!accessKey && accessKey.length >= MIN_KEY_LENGTH;
  if (!usable) {
    logger.error(
      `🔒 ${docPath} 未設定有效存取金鑰(需 ${MIN_KEY_LENGTH} 字元以上)，該文件一律回 503。請在 .env 補上金鑰後重啟`
    );
  }

  /** 回傳通過的金鑰；沒通過時已經寫出回應並回 null */
  const authorize = (req: Request, res: Response): string | null => {
    if (!usable) {
      res.status(503).type('text/plain; charset=utf-8').send('文件尚未開放：伺服器未設定存取金鑰');
      return null;
    }

    const presented = presentedKey(req, cookieName);
    if (!presented || !safeEqual(presented, accessKey!)) {
      logger.warn(`🔒 ${docPath} 存取被拒 ip=${req.ip ?? 'unknown'} hasKey=${!!presented}`);
      res.status(401).type('text/plain; charset=utf-8').send('文件金鑰無效或未提供');
      return null;
    }

    return presented;
  };

  // 文件頁：只擋掛載點本身(req.path 為 '/')，底下的靜態檔放行
  app.use(docPath, (req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/') return next();

    const key = authorize(req, res);
    if (!key) return;

    // 種下 cookie，讓頁面載入後抓 spec 時過得了同一道檢查
    res.cookie(cookieName, key, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS
    });

    next();
  });

  // spec JSON：一律要金鑰 —— 這才是真正要保護的東西，文件頁只是外殼
  app.use(specPath, (req: Request, res: Response, next: NextFunction) => {
    if (!authorize(req, res)) return;
    next();
  });

  SwaggerModule.setup(docPath.slice(1), app, document, {
    jsonDocumentUrl: specPath.slice(1),
    customSiteTitle: title,
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true, tagsSorter: 'alpha' }
  });

  const tags = document.tags?.map((tag) => tag.name) ?? [];
  const endpoints = Object.values(document.paths ?? {}).reduce(
    (sum, item) => sum + Object.values(item).filter((op) => (op as { summary?: string })?.summary).length,
    0
  );

  logger.log(`📘 ${docPath}　${endpoints} 支端點／${tags.length} 個章節${usable ? '（需金鑰）' : '（金鑰未設定，回 503）'}`);
}

/**
 * 建立全部 API 文件。
 *
 * **內部一份、對外一單位一份**，全部需要金鑰。
 *
 * 分開的理由不是排版，是**內容隔離**：對外文件經過兩層過濾(模組 + tag)，
 * 對方就算直接抓 spec JSON 也只看得到自己那幾支 —— 而內部文件裡有
 * 帳號管理、二篩薪資、排程觸發這些不該讓對接廠商知道存在的東西。
 *
 * 必須在 `app.listen()` 之前呼叫。
 */
export function setupApiDocs(app: NestExpressApplication, envService: EnvService): void {
  const { internalKey, vendors } = envService.getApiDocsConfig();

  for (const vendor of VENDOR_DOCS) {
    const config = new DocumentBuilder()
      .setTitle(`道路巡查 Demo API — ${vendor.name}`)
      .setDescription('對接介面文件')
      .setVersion('1.0.0')
      .addTag(vendor.tag, vendor.tagDescription);

    if (vendor.auth === 'apiKey') config.addApiKey(API_KEY_AUTH_SCHEME, API_KEY_AUTH);
    else config.addBearerAuth(API_AUTH_SCHEME, API_AUTH);

    // autoTagControllers 要關掉：controller 沒在 class 層標 @ApiTags 時，
    // Nest 會自動用 controller 名稱補一個 tag，於是每支都額外多掛一個
    const raw = SwaggerModule.createDocument(app, config.build(), {
      include: vendor.modules,
      autoTagControllers: false
    });
    const document = keepDocumented(pickByTag(raw, vendor.tag));

    // 標錯 tag 會把別家的介面撈進這份文件，寧可啟動失敗也不要默默發出去
    assertTagsWithin(document, [vendor.tag]);

    setupGuardedDoc(app, {
      path: `api-docs/${vendor.code}`,
      document,
      title: document.info.title,
      accessKey: vendors?.[vendor.code]
    });
  }

  const internalConfig = new DocumentBuilder()
    .setTitle('道路巡查 Demo API（內部）')
    .setDescription([INTERNAL_API_DESCRIPTION, '', buildVendorDocsIndex(vendors)].join('\n'))
    .setVersion('1.0.0')
    .addBearerAuth(API_AUTH_SCHEME, API_AUTH)
    .addApiKey(API_KEY_AUTH_SCHEME, API_KEY_AUTH);

  INTERNAL_DOC_TAGS.forEach((tag) => internalConfig.addTag(tag.name, tag.description));

  const internalDocument = keepDocumented(
    SwaggerModule.createDocument(app, internalConfig.build(), {
      ...(INTERNAL_DOC_MODULES ? { include: INTERNAL_DOC_MODULES } : {}),
      autoTagControllers: false
    })
  );

  setupGuardedDoc(app, {
    path: 'internal-docs',
    document: internalDocument,
    title: internalDocument.info.title,
    accessKey: internalKey
  });
}

/**
 * 對外文件索引，放在內部文件最上方。
 *
 * 放在這裡的理由：連結是執行期由設定拼出來的，程式碼裡沒有完整網址，不好查；
 * 而內部文件本來就要金鑰才進得來，等於現成的權限邊界，不必另開一頁。
 *
 * **只列路徑與「金鑰有沒有設定」，不帶金鑰值** —— 否則持有內部金鑰
 * 就等於持有全部對外文件的金鑰，而且金鑰會散進 spec JSON 裡。
 */
export const buildVendorDocsIndex = (vendors: Record<string, string | undefined> = {}): string => {
  const rows = VENDOR_DOCS.map((vendor) => {
    const status = vendors[vendor.code] ? '已設定' : '⚠️ 未設定，該文件回 503';
    return `| ${vendor.name} | \`${vendor.tag}\` | \`/api-docs/${vendor.code}\` | ${status} |`;
  });

  return [
    '### 對外文件',
    '',
    '| 對接單位 | 章節 tag | 路徑 | 金鑰 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '開啟需帶該單位的金鑰（`?k=` 或 `X-Docs-Key` 表頭），金鑰值請查 `.env` 的 `DOCS_*`。',
    '金鑰一單位一把，可個別撤銷；只把對應那一條交給該單位，勿轉發他家的連結。',
    '',
    '⚠️ 新增端點若沒掛上對外文件列出的 tag，不會出現在任何一份對外文件 ——',
    '這是刻意的預設：漏列只是少一支，誤列是把別家的介面攤給對方看。'
  ].join('\n');
};
