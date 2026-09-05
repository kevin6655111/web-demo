import { MigrationInterface, QueryRunner } from 'typeorm';

/** 客服即時對話 */
export class SupportChat1756771200000 implements MigrationInterface {
  name = 'SupportChat1756771200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "support_threads" (
        "id"               SERIAL PRIMARY KEY,
        "company_id"       integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "requester_id"     integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "agent_id"         integer REFERENCES "users"("id") ON DELETE SET NULL,
        "subject"          varchar(100) NOT NULL,
        "category"         varchar(10) NOT NULL DEFAULT 'OTHER',
        "state"            varchar(10) NOT NULL DEFAULT 'OPEN',
        "last_message_at"  timestamptz,
        "unread_for_user"  integer NOT NULL DEFAULT 0,
        "unread_for_agent" integer NOT NULL DEFAULT 0,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_support_company_state" ON "support_threads" ("company_id", "state")`);
    await queryRunner.query(`CREATE INDEX "idx_support_requester" ON "support_threads" ("requester_id")`);

    await queryRunner.query(`
      CREATE TABLE "support_messages" (
        "id"         SERIAL PRIMARY KEY,
        "thread_id"  integer NOT NULL REFERENCES "support_threads"("id") ON DELETE CASCADE,
        "sender_id"  integer REFERENCES "users"("id") ON DELETE SET NULL,
        "from_agent" boolean NOT NULL DEFAULT false,
        "body"       varchar(1000) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // 對話的查詢一律是「某條對話、依時間」，複合索引直接對上這個形狀
    await queryRunner.query(`CREATE INDEX "idx_support_msg_thread" ON "support_messages" ("thread_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "support_messages"`);
    await queryRunner.query(`DROP TABLE "support_threads"`);
  }
}
