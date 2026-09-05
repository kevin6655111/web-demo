import '@/env.bootstrap';
import 'reflect-metadata';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from '@/app.module';
import { EnvService } from '@/env/env.service';
import { API_AUTH, API_AUTH_SCHEME, API_DESCRIPTION, keepDocumented } from '@/util/app-swagger';

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

  // ───── Swagger ───────────────────────────────────────────────────

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${config.name} API`)
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0.0')
    .addBearerAuth(API_AUTH_SCHEME, API_AUTH)
    .addTag('Auth', '登入、續期、臨時 Token、帳號管理')
    .addTag('Role', '角色與權限')
    .addTag('Core', '代碼表、系統公告、圖形驗證碼')
    .addTag('Orgstruct', '使用者導覽選單(資料驅動的側邊欄)')
    .addTag('Project', '標案')
    .addTag('Case-Patrol', '巡查案件：新增、查詢、統計')
    .addTag('Case-History', '案件版本歷程：快照、比較、還原')
    .addTag('Work-Order', '派工、施工回報、驗收')
    .addTag('Fleet', '車隊與軌跡')
    .addTag('Road-Eval', '路段評估')
    .addTag('Patrol-Setting', '巡查計畫與覆蓋率')
    .addTag('Survey', '鋪面調查')
    .addTag('Report', '報表產製')
    .addTag('Dashboard', '儀表板')
    .addTag('Geo', '行政區界線、地址自動完成')
    .addTag('Realtime', '即時通訊(WebSocket 的 HTTP 補充介面)')
    .addTag('Support', '客服對話')
    .addTag('Task', '排程')
    .build();

  const document = keepDocumented(SwaggerModule.createDocument(app, swaggerConfig));
  SwaggerModule.setup('api-docs', app, document, { jsonDocumentUrl: 'api-docs-json' });

  // ───── 微服務：訂閱事件，讓 WebSocket 收得到 ──────────────────────

  const redis = envService.getRedisConfig();
  app.connectMicroservice({ transport: Transport.REDIS, options: { host: redis.host, port: redis.port } }, { inheritAppConfig: true });
  await app.startAllMicroservices();

  // ───── WebSocket ─────────────────────────────────────────────────

  app.useWebSocketAdapter(new WsAdapter(app));

  // ───── 啟動 ──────────────────────────────────────────────────────

  app.enableShutdownHooks();
  await app.listen(httpPort, host);

  logger.log(`🚀 API   http://localhost:${httpPort}/api`);
  logger.log(`📖 Docs  http://localhost:${httpPort}/api-docs`);
})();
