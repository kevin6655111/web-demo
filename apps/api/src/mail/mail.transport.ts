import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@/env/env.service';

/** 寄送結果；失敗時附上原因供重送判斷 */
export type SendResult = { delivered: boolean; detail: string };

/**
 * 郵件傳輸層。
 *
 * 未設定 SMTP 時進入**記錄模式**：不實際連線，僅記錄一行日誌並視為成功。
 * 郵件內容已完整保存於 `mail_jobs`，可由管理介面檢視。
 *
 * 這樣設計的原因：Demo 若在未設定 SMTP 時直接失敗，整條通知流程就無法示範；
 * 若靜默略過，又會讓「郵件功能是否正常」無從判斷。記錄模式兩者兼顧 ——
 * 流程走得完，而狀態明確標示為未實際寄出。
 *
 * 正式環境設定 SMTP 後，同一段程式改走實際寄送，呼叫端無須調整。
 */
@Injectable()
export class MailTransport {
  private readonly logger = new Logger('MailTransport');

  constructor(private readonly envService: EnvService) {}

  /** SMTP 是否已設定；未設定時走記錄模式 */
  public get configured(): boolean {
    return Boolean(process.env.SMTP_HOST);
  }

  public async send(to: string, subject: string, body: string): Promise<SendResult> {
    if (!this.configured) {
      this.logger.log(`📭 記錄模式（未設定 SMTP）：${subject} → ${to}`);
      return { delivered: false, detail: '未設定 SMTP，已記錄但未實際寄出' };
    }

    // 正式環境在此接上 SMTP 用戶端（nodemailer 等）。
    // Demo 不引入該依賴：它會出現在後端映像檔裡，而這裡永遠不會執行到。
    this.logger.warn(`✉️  SMTP 已設定但傳輸實作未接上：${subject} → ${to}`);
    throw new Error('SMTP 傳輸實作未接上；請在 MailTransport.send 中接上郵件用戶端');
  }
}
