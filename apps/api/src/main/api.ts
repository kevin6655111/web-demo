import '@/env.bootstrap';
import 'reflect-metadata';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Transport } from '@nestjs/microservices';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from '@/app.module';
import { EnvService } from '@/env/env.service';
import { setupApiDocs } from '@/api-docs/api-docs.bootstrap';

(async () => {
  const logger = new Logger('Server');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const envService = app.get(EnvService);
  const config = envService.getAppConfig();
  const isProd = envService.getNodeEnv() === 'production';

  const host = '0.0.0.0';
  const httpPort = Number(process.env.PORT ?? config.port.http ?? 3008);

  // ───── 安全表頭 ──────────────────────────────────────────────────

  app.use(
    helmet({
      // API 不回傳 HTML，CSP 對它沒有意義；前端的 CSP 由 nginx 負責
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false
    })
  );
  app.disable('x-powered-by');

  // 反向代理後面要信任 X-Forwarded-For，否則流量限制看到的都是 nginx 的 IP
  app.set('trust proxy', 1);

  // ───── Router ────────────────────────────────────────────────────

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  // 明確的大小上限：沒有上限等於開放記憶體耗盡攻擊
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  // CORS 白名單：正式環境只允許自己的網域，開發才放行本機
  const allowed = isProd ? [envService.getDomain()] : [/^http:\/\/localhost:\d+$/];
  app.enableCors({ origin: allowed, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // 自動把 query/body 轉成對應型別(字串 → number)
      whitelist: true, // DTO 沒定義的欄位會被丟掉
      forbidNonWhitelisted: true, // 傳多的欄位直接 400
      // 正式環境不回傳詳細的驗證訊息：那會洩漏內部欄位結構
      disableErrorMessages: false
    })
  );

  // ───── API 文件 ──────────────────────────────────────────────────
  //
  // 內部一份、對外一單位一份，全部需要金鑰。
  // 分開的理由不是排版而是內容隔離：對外文件經過模組與 tag 兩層過濾，
  // 對方就算直接抓 spec JSON 也只看得到自己那幾支。

  setupApiDocs(app, envService);

  // ───── 微服務：訂閱事件，讓 WebSocket 收得到 ──────────────────────

  const redis = envService.getRedisConfig();
  app.connectMicroservice(
    { transport: Transport.REDIS, options: { host: redis.host, port: redis.port } },
    { inheritAppConfig: true }
  );
  await app.startAllMicroservices();

  // ───── WebSocket ─────────────────────────────────────────────────

  app.useWebSocketAdapter(new WsAdapter(app));

  // ───── 啟動 ──────────────────────────────────────────────────────

  app.enableShutdownHooks();
  await app.listen(httpPort, host);

  logger.log(`🚀 API   http://localhost:${httpPort}/api`);
  logger.log(`📖 內部文件  http://localhost:${httpPort}/internal-docs?k=<DOCS_INTERNAL_KEY>`);
})();
