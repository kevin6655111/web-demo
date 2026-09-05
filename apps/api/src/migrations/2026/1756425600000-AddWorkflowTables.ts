import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 標案、派工、歷程、報表。
 *
 * 與初始 schema 分開的理由：初始 schema 已經在跑的環境上執行過了，
 * 改它會讓已部署的站台與新站台走上不同的路徑 —— migration 只能往前加。
 */
export class AddWorkflowTables1756425600000 implements MigrationInterface {
  name = 'AddWorkflowTables1756425600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 標案 ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id"         SERIAL PRIMARY KEY,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "code"       varchar(40) NOT NULL,
        "name"       varchar(100) NOT NULL,
        "authority"  varchar(60),
        "state"      varchar(10) NOT NULL DEFAULT 'DRAFT',
        "start_date" date,
        "end_date"   date,
        "budget"     numeric(14,0) NOT NULL DEFAULT 0,
        "road_km"    numeric(8,2) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_project_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_project_company_state" ON "projects" ("company_id", "state")`);

    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL`);
    await queryRunner.query(`CREATE INDEX "idx_case_project" ON "patrol_cases" ("project_id")`);

    // ─── 派工單 ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "work_orders" (
        "id"            SERIAL PRIMARY KEY,
        "company_id"    integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "case_id"       integer NOT NULL REFERENCES "patrol_cases"("id") ON DELETE CASCADE,
        "order_no"      varchar(40) NOT NULL,
        "state"         varchar(15) NOT NULL DEFAULT 'ASSIGNED',
        "assignee_id"   integer REFERENCES "users"("id") ON DELETE SET NULL,
        "dispatcher_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "repair_method" varchar(20),
        "due_at"        timestamptz,
        "finished_at"   timestamptz,
        "accepted_at"   timestamptz,
        "photo_key"     varchar(200),
        "remark"        varchar(300),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        -- 一個案件同時只有一張派工單：重複派工是現場糾紛的來源，擋在資料層最可靠
        CONSTRAINT "uq_work_order_case" UNIQUE ("case_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_work_order_company_state" ON "work_orders" ("company_id", "state")`);
    await queryRunner.query(`CREATE INDEX "idx_work_order_assignee" ON "work_orders" ("assignee_id")`);

    // ─── 案件歷程 ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "case_histories" (
        "id"          SERIAL PRIMARY KEY,
        "case_id"     integer NOT NULL REFERENCES "patrol_cases"("id") ON DELETE CASCADE,
        "action"      varchar(20) NOT NULL,
        "from_state"  varchar(20),
        "to_state"    varchar(20),
        "operator_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "source"      varchar(10) NOT NULL DEFAULT 'USER',
        "note"        varchar(300),
        "created_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_history_case" ON "case_histories" ("case_id")`);
    await queryRunner.query(`CREATE INDEX "idx_history_created_at" ON "case_histories" ("created_at")`);

    // ─── 報表工作 ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "report_jobs" (
        "id"           SERIAL PRIMARY KEY,
        "company_id"   integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "requester_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "dedup_key"    varchar(80) NOT NULL,
        "format"       varchar(10) NOT NULL,
        "state"        varchar(10) NOT NULL DEFAULT 'PENDING',
        "params"       jsonb NOT NULL,
        "row_count"    integer NOT NULL DEFAULT 0,
        "file_key"     varchar(200),
        "error"        text,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        -- 同樣條件的報表在完成前重複請求，回同一筆工作而不是再排一份
        CONSTRAINT "uq_report_dedup_key" UNIQUE ("dedup_key")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_report_company_state" ON "report_jobs" ("company_id", "state")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "report_jobs"`);
    await queryRunner.query(`DROP TABLE "case_histories"`);
    await queryRunner.query(`DROP TABLE "work_orders"`);
    await queryRunner.query(`DROP INDEX "idx_case_project"`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" DROP COLUMN "project_id"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
