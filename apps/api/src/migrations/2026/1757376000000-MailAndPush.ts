import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 郵件工作與推播裝置。
 *
 * 兩者屬於同一類機制：把「通知使用者」從業務流程中抽離，
 * 讓寄送失敗不影響派工、驗收等主要流程的完成。
 *
 * 郵件內容落地保存而非僅存於佇列，是為了可稽核（有沒有寄出）、
 * 可重送（指定重送哪幾封）與可檢視（未設定 SMTP 時仍能確認內容）。
 */
export class MailAndPush1757376000000 implements MigrationInterface {
  name = 'MailAndPush1757376000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mail_jobs" (
        "id"         SERIAL PRIMARY KEY,
        "to_address" varchar(200) NOT NULL,
        "subject"    varchar(200) NOT NULL,
        "body"       text         NOT NULL,
        "template"   varchar(40)  NOT NULL,
        "state"      varchar(10)  NOT NULL DEFAULT 'PENDING',
        "attempts"   integer      NOT NULL DEFAULT 0,
        "last_error" varchar(500),
        "sent_at"    timestamptz,
        "created_at" timestamptz  NOT NULL DEFAULT now(),
        "updated_at" timestamptz  NOT NULL DEFAULT now()
      )
    `);

    // 維運介面預設查「失敗的、最近的」，複合索引直接對上該查詢
    await queryRunner.query(`CREATE INDEX "idx_mail_job_state" ON "mail_jobs" ("state", "created_at" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "device_tokens" (
        "id"             SERIAL PRIMARY KEY,
        "user_id"        integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token"          varchar(255) NOT NULL,
        "platform"       varchar(10)  NOT NULL,
        "device_name"    varchar(100),
        "is_active"      boolean      NOT NULL DEFAULT true,
        "last_pushed_at" timestamptz,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        "updated_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_device_token" UNIQUE ("token")
      )
    `);

    // 推播時的查詢一律是「這些使用者的有效裝置」
    await queryRunner.query(`CREATE INDEX "idx_device_token_user" ON "device_tokens" ("user_id", "is_active")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "device_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mail_jobs"`);
  }
}
