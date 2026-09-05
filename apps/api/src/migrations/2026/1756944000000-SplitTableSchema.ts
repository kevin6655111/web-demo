import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 依實際營運的資料表重構 schema。
 *
 * 三個結構性的改動：
 *
 * 1. **案件與派工單分表**
 *    主表只放「來源寫進來就不再改」的內容（車機的量測值、座標、照片路徑）；
 *    地址另立一張（非同步補的，補不到也不該讓案件進不來）；
 *    狀態再一張（人改的，而且改得頻繁）。
 *    合成一張的話，車機每天幾千筆的寫入會跟承辦的編輯搶同一列。
 *
 * 2. **標案關聯改成關聯表**
 *    公司、車輛、工務段轄區都可能中途調整，但去年的案件仍要查得到當時的歸屬。
 *    關聯表帶 is_active，停用而不刪除。
 *
 * 3. **歷程改為版本化**
 *    主鍵 (case_type, case_id, version)，四種實體共用一張表。
 *
 * 舊表直接重建而不是逐欄搬移：Demo 的資料由 seed 產生，
 * 為示範資料寫一套資料轉換只會讓這份 migration 更難讀。
 * 正式站台的等價做法是「新表 + 回填 + 切換讀寫 + 移除舊表」四段式。
 */
export class SplitTableSchema1756944000000 implements MigrationInterface {
  name = 'SplitTableSchema1756944000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 依外鍵倒序丟掉舊結構
    await queryRunner.query(`DROP TABLE IF EXISTS "case_histories" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "work_orders" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patrol_cases" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "projects" CASCADE`);

    // ── 標案 ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id"               SERIAL PRIMARY KEY,
        "prj_id"           varchar(10)  NOT NULL,
        "prj_no"           varchar(30),
        "prj_name"         varchar(50)  NOT NULL,
        "prj_main"         varchar(100) NOT NULL,
        "prj_sub"          varchar(50),
        "start_date"       date NOT NULL,
        "end_date"         date NOT NULL,
        "proprietor"       varchar(30) NOT NULL,
        "proprietor_level" integer NOT NULL DEFAULT 3,
        "state"            varchar(10) NOT NULL DEFAULT 'DRAFT',
        "budget"           numeric(14,0) NOT NULL DEFAULT 0,
        "road_km"          numeric(8,2)  NOT NULL DEFAULT 0,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_project_prj_id" UNIQUE ("prj_id")
      )
    `);

    // 案件自動編碼排程用「執行中 + 日期落在期間內」找標案，索引直接對上這個形狀
    await queryRunner.query(`CREATE INDEX "idx_project_period" ON "projects" ("state", "start_date", "end_date")`);

    await queryRunner.query(`
      CREATE TABLE "company_projects" (
        "id"         SERIAL PRIMARY KEY,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id" integer NOT NULL REFERENCES "projects"("id")  ON DELETE CASCADE,
        "role"       varchar(10) NOT NULL DEFAULT 'MAIN',
        "is_active"  boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_company_project" UNIQUE ("company_id", "project_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "project_vehicles" (
        "id"         SERIAL PRIMARY KEY,
        "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "vehicle_id" integer NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
        "is_active"  boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_project_vehicle" UNIQUE ("project_id", "vehicle_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sections" (
        "id"         SERIAL PRIMARY KEY,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "key"        varchar(10) NOT NULL,
        "name"       varchar(50) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_section_key" UNIQUE ("company_id", "key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "areas" (
        "id"         SERIAL PRIMARY KEY,
        "county"     varchar(10) NOT NULL,
        "district"   varchar(10) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_area" UNIQUE ("county", "district")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "project_sections" (
        "id"         SERIAL PRIMARY KEY,
        "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "section_id" integer NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
        "is_active"  boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_project_section" UNIQUE ("project_id", "section_id")
      )
    `);

    // 轄區掛在「標案-工務段」之下而不是工務段本身：
    // 同一個工務段在不同標案負責的行政區可以不同
    await queryRunner.query(`
      CREATE TABLE "section_areas" (
        "id"                 SERIAL PRIMARY KEY,
        "project_section_id" integer NOT NULL REFERENCES "project_sections"("id") ON DELETE CASCADE,
        "area_id"            integer NOT NULL REFERENCES "areas"("id") ON DELETE CASCADE,
        "is_active"          boolean NOT NULL DEFAULT true,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_section_area" UNIQUE ("project_section_id", "area_id")
      )
    `);

    // ── 破壞案件（主表 / 地址 / 狀態）─────────────────────────
    await queryRunner.query(`
      CREATE TABLE "patrol_cases" (
        "id"           SERIAL PRIMARY KEY,
        "company_id"   integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id"   integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "case_num"     varchar(30),
        "external_id"  varchar(60) NOT NULL,
        "source"       varchar(10) NOT NULL DEFAULT 'VEHICLE',
        "dt_record"    timestamptz(3) NOT NULL,
        "car"          varchar(20),
        "vehicle_id"   integer REFERENCES "vehicles"("id") ON DELETE SET NULL,
        "crack_type"   varchar(30) NOT NULL,
        "degree"       varchar(1) NOT NULL DEFAULT 'C',
        "crack_id"     integer NOT NULL DEFAULT 0,
        "length"       double precision NOT NULL DEFAULT 0,
        "width"        double precision NOT NULL DEFAULT 0,
        "area"         double precision NOT NULL DEFAULT 0,
        "depth"        double precision,
        "img"          varchar(255),
        "img_detect"   varchar(255),
        "img_map_area" varchar(50),
        "longitude"    double precision NOT NULL,
        "latitude"     double precision NOT NULL,
        "altitude"     real,
        "geom"         geography(Point, 4326) NOT NULL,
        "serial_no"    integer,
        "path"         varchar(255),
        "remark"       varchar(300),
        "reporter_id"  integer REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        -- 車機重送同一筆時擋在資料庫這一層：HTTP 與佇列的去重都可能失效，
        -- 唯一鍵是最後一道，而且是唯一一道不依賴應用程式還活著的
        CONSTRAINT "uq_case_dt_img_crack" UNIQUE ("dt_record", "img_detect", "crack_id"),
        CONSTRAINT "uq_case_external_id"  UNIQUE ("external_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_case_geom" ON "patrol_cases" USING GIST ("geom")`);
    await queryRunner.query(`CREATE INDEX "idx_case_company_time" ON "patrol_cases" ("company_id", "dt_record" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_case_project" ON "patrol_cases" ("project_id")`);
    await queryRunner.query(`CREATE INDEX "idx_case_crack_type" ON "patrol_cases" ("crack_type", "degree")`);

    await queryRunner.query(`
      CREATE TABLE "patrol_case_addresses" (
        "id"           SERIAL PRIMARY KEY,
        "case_id"      integer NOT NULL REFERENCES "patrol_cases"("id") ON DELETE CASCADE,
        "county"       varchar(10),
        "district"     varchar(10),
        "cavlge"       varchar(10),
        "neighbor"     varchar(10),
        "road"         varchar(100),
        "house_number" varchar(100),
        "address"      varchar(150),
        "o_address"    varchar(200),
        CONSTRAINT "uq_case_address" UNIQUE ("case_id")
      )
    `);

    // 行政區與路名是最常用的查詢條件，而它們在這張表
    await queryRunner.query(`CREATE INDEX "idx_case_addr_district" ON "patrol_case_addresses" ("county", "district")`);
    await queryRunner.query(`CREATE INDEX "idx_case_addr_road" ON "patrol_case_addresses" ("road")`);

    await queryRunner.query(`
      CREATE TABLE "patrol_case_statuses" (
        "id"                  SERIAL PRIMARY KEY,
        "case_id"             integer NOT NULL REFERENCES "patrol_cases"("id") ON DELETE CASCADE,
        "status"              integer NOT NULL DEFAULT 0,
        "upd_status_usr"      integer REFERENCES "users"("id") ON DELETE SET NULL,
        "upd_status_usr_at"   timestamptz,
        "upd_status_adm"      integer REFERENCES "users"("id") ON DELETE SET NULL,
        "upd_status_adm_at"   timestamptz,
        "edited"              integer NOT NULL DEFAULT 0,
        "upd_edited_usr"      integer REFERENCES "users"("id") ON DELETE SET NULL,
        "upd_edited_at"       timestamptz,
        "need_repair"         integer NOT NULL DEFAULT 0,
        "upd_need_repair_usr" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "upd_need_repair_at"  timestamptz,
        CONSTRAINT "uq_case_status" UNIQUE ("case_id")
      )
    `);

    // 三種狀態各自獨立查：篩選「需修繕未派工」不該掃全表
    await queryRunner.query(`CREATE INDEX "idx_case_status" ON "patrol_case_statuses" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_case_need_repair" ON "patrol_case_statuses" ("need_repair")`);

    // ── 派工單（主表 / 狀態 / 照片 / 取樣）────────────────────
    await queryRunner.query(`
      CREATE TABLE "work_orders" (
        "id"                 SERIAL PRIMARY KEY,
        "company_id"         integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id"         integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "case_num"           varchar(30) NOT NULL,
        "type"               varchar(2)  NOT NULL,
        "dispatch_date"      date NOT NULL,
        "due_date"           date,
        "work_start_date"    date,
        "work_end_date"      date,
        "worker_user_id"     integer REFERENCES "users"("id") ON DELETE SET NULL,
        "dispatcher_id"      integer REFERENCES "users"("id") ON DELETE SET NULL,
        "county"             varchar(10),
        "district"           varchar(10) NOT NULL,
        "cavlge"             varchar(10),
        "address"            varchar(100) NOT NULL,
        "start_addr"         varchar(100),
        "end_addr"           varchar(100),
        "start_geom"         geography(Point, 4326),
        "end_geom"           geography(Point, 4326),
        "material"           varchar(10),
        "material_size"      double precision,
        "work_length"        double precision,
        "work_width"         double precision,
        "work_depth_milling" double precision,
        "work_depth_paving"  double precision,
        "remark"             varchar(250),
        "case_patrol_id"     integer REFERENCES "patrol_cases"("id") ON DELETE SET NULL,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_order_case_num" UNIQUE ("case_num"),
        -- 一個案件只能派一張單：重複派工在現場就是兩班人去修同一個坑
        CONSTRAINT "uq_order_source_case" UNIQUE ("case_patrol_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_order_company_date" ON "work_orders" ("company_id", "dispatch_date" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_order_worker" ON "work_orders" ("worker_user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_order_due" ON "work_orders" ("due_date")`);

    await queryRunner.query(`
      CREATE TABLE "work_order_statuses" (
        "id"             SERIAL PRIMARY KEY,
        "work_order_id"  integer NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
        "status"         integer NOT NULL DEFAULT 0,
        "upd_status_usr" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "upd_status_at"  timestamptz NOT NULL DEFAULT now(),
        "reject_reason"  varchar(250),
        CONSTRAINT "uq_order_status" UNIQUE ("work_order_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_order_status" ON "work_order_statuses" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "work_order_images" (
        "id"            SERIAL PRIMARY KEY,
        "work_order_id" integer NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
        "img_type"      varchar(50)  NOT NULL,
        "img_type_ch"   varchar(50)  NOT NULL,
        "img_name"      varchar(150) NOT NULL,
        "img_path"      varchar(250) NOT NULL,
        "size_bytes"    integer NOT NULL DEFAULT 0,
        "mime_type"     varchar(60),
        "uploaded_by"   integer REFERENCES "users"("id") ON DELETE SET NULL,
        "uploaded_at"   timestamptz NOT NULL DEFAULT now(),
        -- 同一類型只留一張：驗收要的是「這個階段的照片」，不是同一階段的二十張。
        -- 現場重拍是常態，所以重傳覆寫而不是長出第二筆
        CONSTRAINT "uq_order_image_type" UNIQUE ("work_order_id", "img_type")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "work_order_improvements" (
        "id"            SERIAL PRIMARY KEY,
        "work_order_id" integer NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
        "sample_taken"  boolean NOT NULL DEFAULT false,
        "sample_date"   date,
        "test_item"     jsonb,
        "test_result"   varchar(250),
        CONSTRAINT "uq_order_improvement" UNIQUE ("work_order_id")
      )
    `);

    // ── 版本化歷程 ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "case_histories" (
        "case_type"     varchar(20) NOT NULL,
        "case_id"       integer NOT NULL,
        "version"       integer NOT NULL,
        "snapshot_json" jsonb NOT NULL,
        "changes_json"  jsonb,
        "action"        varchar(30),
        "from_state"    varchar(30),
        "to_state"      varchar(30),
        "source"        varchar(10) NOT NULL DEFAULT 'USER',
        "note"          varchar(300),
        "client_ip"     varchar(45),
        "modified_by"   integer REFERENCES "users"("id") ON DELETE SET NULL,
        "modified_at"   timestamptz NOT NULL DEFAULT now(),
        -- 版本號是主鍵的一部分：兩個同時發生的變更不可能拿到同一個版本，
        -- 撞號會在這裡直接失敗，而不是靜靜覆蓋掉別人的那一版
        CONSTRAINT "pk_case_history" PRIMARY KEY ("case_type", "case_id", "version")
      )
    `);

    // 稽核查的是「這段期間誰改了什麼」，跨實體，所以索引在時間與人身上
    await queryRunner.query(`CREATE INDEX "idx_history_time" ON "case_histories" ("modified_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_history_operator" ON "case_histories" ("modified_by", "modified_at" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'case_histories',
      'work_order_improvements',
      'work_order_images',
      'work_order_statuses',
      'work_orders',
      'patrol_case_statuses',
      'patrol_case_addresses',
      'patrol_cases',
      'section_areas',
      'project_sections',
      'areas',
      'sections',
      'project_vehicles',
      'company_projects',
      'projects'
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
