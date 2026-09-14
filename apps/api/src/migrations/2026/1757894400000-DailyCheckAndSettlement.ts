import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 每日檢查與儀表板結算。
 *
 * 兩張表的共同理由是**「即時算會越來越慢」**：
 *
 * 儀表板要的是「這個月每天每個行政區的巡查里程與案件數」——
 * 那要掃整月的軌跡點(每台車每天七千筆)與案件，一次要幾秒鐘。
 * 而看板是掛在牆上整天刷新的。
 *
 * 每日檢查要的是「昨天各車上傳了幾筆、圖片檔在不在」——
 * 圖片存在與否要逐筆問物件儲存，那更慢。
 *
 * 兩者都由排程結算並覆寫（`ON CONFLICT DO UPDATE`），所以補跑不會讓數字翻倍。
 *
 * 拆成兩張表而不是一張：巡查與派工的維度相同但欄位完全不同，
 * 硬要合併會得到一張半數欄位永遠是 NULL 的表。
 */
export class DailyCheckAndSettlement1757894400000 implements MigrationInterface {
  name = 'DailyCheckAndSettlement1757894400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "daily_checks" (
        "id"             SERIAL PRIMARY KEY,
        "company_id"     integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "check_date"     date NOT NULL,
        "project_id"     integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "car"            varchar(20) NOT NULL DEFAULT '(未指定)',
        "county"         varchar(10),
        "district"       varchar(10),
        "case_count"     integer NOT NULL DEFAULT 0,
        "image_total"    integer NOT NULL DEFAULT 0,
        "image_missing"  integer NOT NULL DEFAULT 0,
        "track_points"   integer NOT NULL DEFAULT 0,
        "first_at"       timestamptz,
        "last_at"        timestamptz,
        "uploaded"       boolean NOT NULL DEFAULT false,
        "note"           varchar(200),
        "checked_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_daily_check" UNIQUE ("company_id", "check_date", "project_id", "car", "district")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_daily_check_date" ON "daily_checks" ("company_id", "check_date" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "dashboard_case_stats" (
        "id"                SERIAL PRIMARY KEY,
        "company_id"        integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "stat_date"         date NOT NULL,
        "project_id"        integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "county"            varchar(10),
        "district"          varchar(10),
        "mileage_km"        numeric(10,2) NOT NULL DEFAULT 0,
        "patrol_days"       integer NOT NULL DEFAULT 0,
        "case_total"        integer NOT NULL DEFAULT 0,
        "pothole"           integer NOT NULL DEFAULT 0,
        "alligator_crack"   integer NOT NULL DEFAULT 0,
        "linear_crack"      integer NOT NULL DEFAULT 0,
        "patch"             integer NOT NULL DEFAULT 0,
        "manhole_cover"     integer NOT NULL DEFAULT 0,
        "other_crack"       integer NOT NULL DEFAULT 0,
        "area_m2"           numeric(12,2) NOT NULL DEFAULT 0,
        "updated_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_dashboard_case_stat" UNIQUE ("company_id", "stat_date", "project_id", "district")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_dashboard_case_stat_date" ON "dashboard_case_stats" ("company_id", "stat_date" DESC)`
    );

    await queryRunner.query(`
      CREATE TABLE "dashboard_order_stats" (
        "id"           SERIAL PRIMARY KEY,
        "company_id"   integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "stat_date"    date NOT NULL,
        "project_id"   integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "county"       varchar(10),
        "district"     varchar(10),
        "dispatched"   integer NOT NULL DEFAULT 0,
        "in_progress"  integer NOT NULL DEFAULT 0,
        "reported"     integer NOT NULL DEFAULT 0,
        "done"         integer NOT NULL DEFAULT 0,
        "overdue"      integer NOT NULL DEFAULT 0,
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_dashboard_order_stat" UNIQUE ("company_id", "stat_date", "project_id", "district")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_dashboard_order_stat_date" ON "dashboard_order_stats" ("company_id", "stat_date" DESC)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dashboard_order_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dashboard_case_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_checks"`);
  }
}
