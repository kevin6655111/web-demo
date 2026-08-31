import { MigrationInterface, QueryRunner } from 'typeorm';

/** 系統公告 */
export class AnnouncementAndCore1756857600000 implements MigrationInterface {
  name = 'AnnouncementAndCore1756857600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "announcements" (
        "id"         SERIAL PRIMARY KEY,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "author_id"  integer REFERENCES "users"("id") ON DELETE SET NULL,
        "title"      varchar(100) NOT NULL,
        "body"       varchar(1000) NOT NULL,
        "level"      varchar(10) NOT NULL DEFAULT 'INFO',
        "start_at"   timestamptz NOT NULL,
        "end_at"     timestamptz,
        "pinned"     boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 查詢一律是「這間公司、現在生效中的」，複合索引直接對上這個形狀
    await queryRunner.query(`CREATE INDEX "idx_announcement_active" ON "announcements" ("company_id", "start_at", "end_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "announcements"`);
  }
}
