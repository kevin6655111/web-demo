import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 鋪面調查的委託明細與現場欄位。
 *
 * 原本的委託單只有標題與期限，實際上業主給的是一份**路段清單**：
 * 哪一條路、從哪個樁號到哪個樁號、要取幾個樣、單雙向、幾車道。
 * 沒有這一層，「這張委託單做完了沒有」只能靠人數點位數。
 *
 * 調查點補上現場欄位：行政區、車道、樁號、天氣、破壞類型與尺寸。
 * 這些是現場人員在 App 上填的，報表(柔性鋪面狀況調查紀錄表)整張都靠它們。
 *
 * `deleted_at` 用軟刪除：業主會要「已刪除案件表」——
 * 硬刪除之後那張報表就永遠是空的。
 */
export class SurveyDetail1757548800000 implements MigrationInterface {
  name = 'SurveyDetail1757548800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "survey_order_details" (
        "id"            SERIAL PRIMARY KEY,
        "order_id"      integer NOT NULL REFERENCES "survey_orders"("id") ON DELETE CASCADE,
        "seq"           integer NOT NULL DEFAULT 1,
        "road"          varchar(100) NOT NULL,
        "road_start"    varchar(60),
        "road_end"      varchar(60),
        "station_k"     integer,
        "station_m"     integer,
        "direction"     varchar(10) NOT NULL DEFAULT 'BOTH',
        "lane_count"    integer NOT NULL DEFAULT 2,
        "sample_count"  integer NOT NULL DEFAULT 1,
        "road_length_m" numeric(10,2),
        "road_width_m"  numeric(6,2),
        "remark"        varchar(200),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_survey_detail_seq" UNIQUE ("order_id", "seq")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_survey_detail_order" ON "survey_order_details" ("order_id")`);

    await queryRunner.query(`
      ALTER TABLE "survey_cases"
        ADD COLUMN "detail_id"    integer REFERENCES "survey_order_details"("id") ON DELETE SET NULL,
        ADD COLUMN "case_num"     varchar(30),
        ADD COLUMN "external_id"  varchar(60),
        ADD COLUMN "county"       varchar(10),
        ADD COLUMN "district"     varchar(10),
        ADD COLUMN "lane"         integer,
        ADD COLUMN "station_k"    integer,
        ADD COLUMN "station_m"    integer,
        ADD COLUMN "weather"      varchar(10),
        ADD COLUMN "dtype"        varchar(30),
        ADD COLUMN "degree"       varchar(1),
        ADD COLUMN "dtype_length" double precision,
        ADD COLUMN "dtype_width"  double precision,
        ADD COLUMN "dtype_area"   double precision,
        ADD COLUMN "dtype_qty"    integer,
        ADD COLUMN "source"       varchar(10) NOT NULL DEFAULT 'WEB',
        ADD COLUMN "deleted_at"   timestamptz,
        ADD COLUMN "deleted_by"   integer REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // 單號在公司內唯一，但舊資料沒有編號 —— 部分索引才不會讓所有 NULL 互相撞
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_survey_case_num" ON "survey_cases" ("company_id", "case_num") WHERE "case_num" IS NOT NULL`
    );
    // App 重送用的去重鍵；網頁排點沒有外部編號，所以是部分唯一索引
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_survey_case_external" ON "survey_cases" ("external_id") WHERE "external_id" IS NOT NULL`
    );
    // 清單一律排除已刪除，索引直接對上這個條件
    await queryRunner.query(
      `CREATE INDEX "idx_survey_case_live" ON "survey_cases" ("company_id", "state") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(`CREATE INDEX "idx_survey_case_detail" ON "survey_cases" ("detail_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_survey_case_detail"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_survey_case_live"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_survey_case_num"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_survey_case_external"`);
    await queryRunner.query(`
      ALTER TABLE "survey_cases"
        DROP COLUMN IF EXISTS "detail_id",
        DROP COLUMN IF EXISTS "case_num",
        DROP COLUMN IF EXISTS "external_id",
        DROP COLUMN IF EXISTS "county",
        DROP COLUMN IF EXISTS "district",
        DROP COLUMN IF EXISTS "lane",
        DROP COLUMN IF EXISTS "station_k",
        DROP COLUMN IF EXISTS "station_m",
        DROP COLUMN IF EXISTS "weather",
        DROP COLUMN IF EXISTS "dtype",
        DROP COLUMN IF EXISTS "degree",
        DROP COLUMN IF EXISTS "dtype_length",
        DROP COLUMN IF EXISTS "dtype_width",
        DROP COLUMN IF EXISTS "dtype_area",
        DROP COLUMN IF EXISTS "dtype_qty",
        DROP COLUMN IF EXISTS "source",
        DROP COLUMN IF EXISTS "deleted_at",
        DROP COLUMN IF EXISTS "deleted_by"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "survey_order_details"`);
  }
}
