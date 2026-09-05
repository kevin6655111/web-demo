import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 巡查單／巡修單，以及派工單的多人施工。
 *
 * 兩件事放在同一支 migration，因為它們是同一個改動的兩面：
 * 巡查單開得出派工單（PD），而現場一張單常是兩三個人一起去。
 *
 * 派工單原本用主表上的 `worker_user_id` 記單一人員 ——
 * 改成關聯表而不是把 id 逗號串在同一欄，否則「這個人這個月被派了幾張單」
 * 會變成字串比對，而那是報表每個月都要跑一次的查詢。
 *
 * 既有資料要回填：直接刪掉舊欄位的話，現有派工單上的人員會憑空消失。
 */
export class MaintenanceAndCrew1757116800000 implements MigrationInterface {
  name = 'MaintenanceAndCrew1757116800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 巡查單 ───────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "maintenances" (
        "id"             SERIAL PRIMARY KEY,
        "company_id"     integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "case_num"       varchar(30) NOT NULL,
        "project_id"     integer NOT NULL REFERENCES "projects"("id"),
        "type"           varchar(2)  NOT NULL,
        "survey_date"    date NOT NULL,
        "survey_user_id" integer REFERENCES "users"("id"),
        "period"         varchar(2),
        "weather"        varchar(4),
        "dtype"          varchar(30),
        "degree"         varchar(1),
        "pothole_number" integer,
        "dtype_length"   double precision,
        "dtype_width"    double precision,
        "dtype_area"     double precision,
        "county"         varchar(10),
        "district"       varchar(10),
        "cavlge"         varchar(10),
        "address"        varchar(100),
        "geom"           geography(Point, 4326),
        "remark"         varchar(250),
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "updated_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_maintenance_case_num" UNIQUE ("case_num")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_maintenance_project_type" ON "maintenances" ("project_id", "type")`);
    await queryRunner.query(`CREATE INDEX "idx_maintenance_survey" ON "maintenances" ("survey_date", "survey_user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_maintenance_admin" ON "maintenances" ("district", "cavlge")`);
    await queryRunner.query(`CREATE INDEX "idx_maintenance_geom" ON "maintenances" USING GIST ("geom")`);

    // 坑洞編號在同一個標案內不可重號：業主的坑洞管制表用它對帳，
    // 撞號時對出來的數量會少一筆，而沒有人查得出少的是哪一筆。
    // 部分索引 —— 非坑洞的單這個欄位是 NULL，不該被唯一性管到
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_maintenance_pothole" ON "maintenances" ("project_id", "pothole_number")
       WHERE "pothole_number" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "maintenance_statuses" (
        "id"             SERIAL PRIMARY KEY,
        "maintenance_id" integer NOT NULL REFERENCES "maintenances"("id") ON DELETE CASCADE,
        "status"         integer NOT NULL DEFAULT 0,
        "upd_status_usr" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "upd_status_at"  timestamptz DEFAULT now(),
        CONSTRAINT "uq_maintenance_status" UNIQUE ("maintenance_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_maintenance_status_value" ON "maintenance_statuses" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "maintenance_repairs" (
        "id"             SERIAL PRIMARY KEY,
        "maintenance_id" integer NOT NULL REFERENCES "maintenances"("id") ON DELETE CASCADE,
        "material"       varchar(10),
        "refill_length"  double precision,
        "refill_width"   double precision,
        "quantity"       integer,
        "repair_date"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_maintenance_repair" UNIQUE ("maintenance_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "maintenance_images" (
        "id"             SERIAL PRIMARY KEY,
        "maintenance_id" integer NOT NULL REFERENCES "maintenances"("id") ON DELETE CASCADE,
        "img_type"       varchar(50) NOT NULL,
        "img_type_ch"    varchar(50) NOT NULL,
        "img_name"       varchar(150) NOT NULL,
        "img_path"       varchar(250) NOT NULL,
        "size_bytes"     integer NOT NULL DEFAULT 0,
        "mime_type"      varchar(60),
        "uploaded_by"    integer REFERENCES "users"("id") ON DELETE SET NULL,
        "uploaded_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_maintenance_image_type" UNIQUE ("maintenance_id", "img_type")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_maintenance_image_case" ON "maintenance_images" ("maintenance_id")`);

    // ─── 派工單：施工單位、來源巡查單、多人施工 ────────────────────

    await queryRunner.query(`
      ALTER TABLE "work_orders"
        ADD COLUMN "work_unit"      varchar(10),
        ADD COLUMN "maintenance_id" integer REFERENCES "maintenances"("id") ON DELETE SET NULL
    `);

    // 一張巡查單同時只能有一張有效派工單 —— 靠應用層先查一次擋不住併發
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_work_order_maintenance" ON "work_orders" ("maintenance_id")
       WHERE "maintenance_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "work_order_users" (
        "id"            SERIAL PRIMARY KEY,
        "work_order_id" integer NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
        "user_id"       integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_work_order_user" UNIQUE ("work_order_id", "user_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_work_order_user_user" ON "work_order_users" ("user_id")`);

    // 回填既有的單一人員。不回填的話，導入這天以前的派工單會全部變成「未指定人員」
    await queryRunner.query(`
      INSERT INTO "work_order_users" ("work_order_id", "user_id")
      SELECT "id", "worker_user_id" FROM "work_orders" WHERE "worker_user_id" IS NOT NULL
    `);

    // 舊索引含 worker_user_id，欄位要移除前得先拆掉
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_work_order_dispatch"`);
    await queryRunner.query(`ALTER TABLE "work_orders" DROP COLUMN "worker_user_id"`);
    await queryRunner.query(`CREATE INDEX "idx_work_order_dispatch" ON "work_orders" ("dispatch_date")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回到單一人員：多人的單只留 id 最小的那一位。
    // 這是有損的 —— 但一個欄位本來就放不下三個人，down 只保證結構回得去
    await queryRunner.query(`ALTER TABLE "work_orders" ADD COLUMN "worker_user_id" integer REFERENCES "users"("id")`);
    await queryRunner.query(`
      UPDATE "work_orders" w
         SET "worker_user_id" = (SELECT MIN("user_id") FROM "work_order_users" u WHERE u."work_order_id" = w."id")
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_work_order_dispatch"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "work_order_users"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_work_order_maintenance"`);
    await queryRunner.query(`ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "maintenance_id", DROP COLUMN IF EXISTS "work_unit"`);
    await queryRunner.query(`CREATE INDEX "idx_work_order_dispatch" ON "work_orders" ("dispatch_date", "worker_user_id")`);

    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_images"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_repairs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_statuses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenances"`);
  }
}
