import * as path from 'path';
import { Injectable } from '@nestjs/common';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

/**
 * 分類日誌：每個用途一個資料夾、按日輪替、保留 30 天。
 * 稽核與營運日誌分開存，出事時不必在同一份檔案裡撈。
 */
@Injectable()
export class LogRecorderService {
  private static readonly BASE_DIR = path.join(process.cwd(), 'logs');
  private readonly cache = new Map<string, winston.Logger>();

  /**
   * 取得(或建立)指定分類的 logger
   * @param category 分類名稱，同時是 logs/ 底下的資料夾名
   */
  public createLogger(category: string, level: string = 'info'): winston.Logger {
    const cached = this.cache.get(category);
    if (cached) return cached;

    const logger = winston.createLogger({
      level,
      format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.json()),
      transports: [
        new winston.transports.DailyRotateFile({
          dirname: path.join(LogRecorderService.BASE_DIR, category),
          filename: `${category}-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          maxFiles: '30d',
          zippedArchive: true
        })
      ]
    });

    this.cache.set(category, logger);
    return logger;
  }
}
