import { MigrationInterface, QueryRunner } from 'typeorm';

/** 案件討論訊息：即時通訊的內容要落地，斷線期間的對話不能消失 */
export class AddCaseMessages1756512000000 implements MigrationInterface {
  name = 'AddCaseMessages1756512000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "case_messages" (
        "id"         SERIAL PRIMARY KEY,
        "case_id"    integer NOT NULL REFERENCES "patrol_cases"("id") ON DELETE CASCADE,
        "sender_id"  integer REFERENCES "users"("id") ON DELETE SET NULL,
        "body"       varchar(500) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 討論串的查詢一律是「某案件、依時間」，複合索引直接對上這個形狀
    await queryRunner.query(`CREATE INDEX "idx_message_case_created" ON "case_messages" ("case_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "case_messages"`);
  }
}
