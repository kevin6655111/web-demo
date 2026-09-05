import '@/env.bootstrap';
import 'reflect-metadata';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TilesAppModule } from '@/tiles.module';

/** tiles 行程：只服務圖層，nginx 會把 /api/tiles/ 導到這裡 */
(async () => {
  const logger = new Logger('Tiles');

  const app = await NestFactory.create<NestExpressApplication>(TilesAppModule);
  const port = Number(process.env.PORT ?? 3010);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  logger.log(`🗺️  Tiles http://localhost:${port}/api/tiles/case`);
})();
