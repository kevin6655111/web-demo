import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 導覽、車隊、軌跡、路段評估、巡查計畫、鋪面調查，以及案件的擴充欄位。
 *
 * 一次加這麼多表是因為它們互相關聯(調查點回寫路段、計畫綁車輛)，
 * 拆成多個 migration 只會讓中間狀態有一段時間是壞的。
 */
export class FleetAndModules1756684800000 implements MigrationInterface {
  name = 'FleetAndModules1756684800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 導覽 ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "modules" (
        "id"              SERIAL PRIMARY KEY,
        "key"             varchar(30) NOT NULL,
        "name"            varchar(30) NOT NULL,
        "icon"            varchar(60),
        "path"            varchar(100),
        "default_sub_nav" varchar(30),
        "sort_order"      integer NOT NULL DEFAULT 0,
        CONSTRAINT "uq_module_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "features" (
        "id"              SERIAL PRIMARY KEY,
        "module_id"       integer NOT NULL REFERENCES "modules"("id") ON DELETE CASCADE,
        "key"             varchar(30) NOT NULL,
        "name"            varchar(30) NOT NULL,
        "icon"            varchar(60),
        "component"       varchar(60),
        "path"            varchar(100),
        "required_action" varchar(40),
        "sort_order"      integer NOT NULL DEFAULT 0,
        CONSTRAINT "uq_feature_key" UNIQUE ("key")
      )
    `);

    // ─── 案件擴充欄位 ───────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "source" varchar(10) NOT NULL DEFAULT 'VEHICLE'`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "severity" varchar(10) NOT NULL DEFAULT 'MEDIUM'`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "district" varchar(30)`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "address" varchar(150)`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "length_m" numeric(8,2)`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "width_m" numeric(8,2)`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "depth_cm" numeric(6,2)`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "vehicle_plate" varchar(15)`);
    await queryRunner.query(`ALTER TABLE "patrol_cases" ADD COLUMN "remark" varchar(300)`);
    await queryRunner.query(`CREATE INDEX "idx_case_company_source" ON "patrol_cases" ("company_id", "source")`);

    // ─── 車輛 ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id"             SERIAL PRIMARY KEY,
        "company_id"     integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "driver_id"      integer REFERENCES "users"("id") ON DELETE SET NULL,
        "project_id"     integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "plate_no"       varchar(15) NOT NULL,
        "name"           varchar(30),
        "vehicle_type"   varchar(10) NOT NULL DEFAULT 'PATROL',
        "state"          varchar(10) NOT NULL DEFAULT 'OFFLINE',
        "device_id"      varchar(40),
        "last_lng"       double precision,
        "last_lat"       double precision,
        "last_report_at" timestamptz,
        "today_km"       numeric(8,2) NOT NULL DEFAULT 0,
        "remark"         varchar(200),
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "updated_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_vehicle_plate" UNIQUE ("company_id", "plate_no")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_vehicle_company_state" ON "vehicles" ("company_id", "state")`);
    // 車機用 device_id 認自己；查詢頻率高(每次上傳都查一次)
    await queryRunner.query(`CREATE INDEX "idx_vehicle_device" ON "vehicles" ("device_id")`);

    // ─── 軌跡 ───────────────────────────────────────────────────
    // 全系統資料量最大的表：一台車每 5 秒一筆，索引只建真的會用到的
    await queryRunner.query(`
      CREATE TABLE "vehicle_tracks" (
        "id"            BIGSERIAL PRIMARY KEY,
        "company_id"    integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "vehicle_id"    integer NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
        "project_id"    integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "geom"          geography(Point,4326) NOT NULL,
        "speed_kph"     real NOT NULL DEFAULT 0,
        "heading"       real,
        "gps_hdop"      real,
        "altitude"      real,
        "is_trip_start" boolean NOT NULL DEFAULT false,
        "recorded_at"   timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_track_vehicle_time" ON "vehicle_tracks" ("vehicle_id", "recorded_at")`);
    await queryRunner.query(`CREATE INDEX "idx_track_company_time" ON "vehicle_tracks" ("company_id", "recorded_at")`);
    await queryRunner.query(`CREATE INDEX "idx_track_geom" ON "vehicle_tracks" USING GIST ("geom")`);

    // ─── 路段評估 ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "road_segments" (
        "id"             SERIAL PRIMARY KEY,
        "company_id"     integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id"     integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "code"           varchar(40) NOT NULL,
        "road_name"      varchar(60) NOT NULL,
        "section"        varchar(40),
        "district"       varchar(30),
        "geom"           geography(LineString,4326) NOT NULL,
        "length_m"       numeric(10,2) NOT NULL DEFAULT 0,
        "lane_count"     integer NOT NULL DEFAULT 2,
        "pci"            numeric(5,2) NOT NULL DEFAULT 100,
        "iri"            numeric(5,2),
        "maintain_level" varchar(10) NOT NULL DEFAULT 'GOOD',
        "case_count"     integer NOT NULL DEFAULT 0,
        "last_eval_at"   timestamptz,
        "remark"         varchar(200),
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "updated_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_segment_code" UNIQUE ("company_id", "code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_segment_company_level" ON "road_segments" ("company_id", "maintain_level")`);
    await queryRunner.query(`CREATE INDEX "idx_segment_geom" ON "road_segments" USING GIST ("geom")`);

    // ─── 巡查計畫 ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "patrol_plans" (
        "id"         SERIAL PRIMARY KEY,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "vehicle_id" integer REFERENCES "vehicles"("id") ON DELETE SET NULL,
        "code"       varchar(40) NOT NULL,
        "name"       varchar(60) NOT NULL,
        "frequency"  varchar(10) NOT NULL DEFAULT 'WEEKLY',
        "route"      geography(LineString,4326) NOT NULL,
        "route_km"   numeric(8,2) NOT NULL DEFAULT 0,
        "buffer_m"   integer NOT NULL DEFAULT 30,
        "active"     boolean NOT NULL DEFAULT true,
        "remark"     varchar(200),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_plan_code" UNIQUE ("company_id", "code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_plan_company_active" ON "patrol_plans" ("company_id", "active")`);
    await queryRunner.query(`CREATE INDEX "idx_plan_geom" ON "patrol_plans" USING GIST ("route")`);

    // ─── 鋪面調查 ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "survey_orders" (
        "id"          SERIAL PRIMARY KEY,
        "company_id"  integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id"  integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "surveyor_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "order_no"    varchar(40) NOT NULL,
        "title"       varchar(100) NOT NULL,
        "state"       varchar(12) NOT NULL DEFAULT 'DRAFT',
        "requester"   varchar(60),
        "due_date"    date,
        "remark"      varchar(300),
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_survey_order_no" UNIQUE ("company_id", "order_no")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_survey_order_state" ON "survey_orders" ("company_id", "state")`);

    await queryRunner.query(`
      CREATE TABLE "survey_cases" (
        "id"           SERIAL PRIMARY KEY,
        "company_id"   integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "order_id"     integer NOT NULL REFERENCES "survey_orders"("id") ON DELETE CASCADE,
        "segment_id"   integer REFERENCES "road_segments"("id") ON DELETE SET NULL,
        "surveyor_id"  integer REFERENCES "users"("id") ON DELETE SET NULL,
        "geom"         geography(Point,4326) NOT NULL,
        "road_name"    varchar(100),
        "method"       varchar(12) NOT NULL DEFAULT 'VISUAL',
        "state"        varchar(10) NOT NULL DEFAULT 'PENDING',
        "thickness_cm" numeric(6,2),
        "pci"          numeric(5,2),
        "iri"          numeric(5,2),
        "photo_key"    varchar(200),
        "surveyed_at"  timestamptz,
        "finding"      varchar(300),
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_survey_case_order" ON "survey_cases" ("order_id")`);
    await queryRunner.query(`CREATE INDEX "idx_survey_case_state" ON "survey_cases" ("company_id", "state")`);
    await queryRunner.query(`CREATE INDEX "idx_survey_case_geom" ON "survey_cases" USING GIST ("geom")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "survey_cases"`);
    await queryRunner.query(`DROP TABLE "survey_orders"`);
    await queryRunner.query(`DROP TABLE "patrol_plans"`);
    await queryRunner.query(`DROP TABLE "road_segments"`);
    await queryRunner.query(`DROP TABLE "vehicle_tracks"`);
    await queryRunner.query(`DROP TABLE "vehicles"`);
    await queryRunner.query(`DROP TABLE "features"`);
    await queryRunner.query(`DROP TABLE "modules"`);

    for (const col of ['source', 'severity', 'district', 'address', 'length_m', 'width_m', 'depth_cm', 'vehicle_plate', 'remark']) {
      await queryRunner.query(`ALTER TABLE "patrol_cases" DROP COLUMN "${col}"`);
    }
  }
}
