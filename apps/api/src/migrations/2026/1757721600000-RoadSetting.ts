import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 道路設定與巡查點。
 *
 * 巡查計畫(`patrol_plans`)回答的是「該走哪條路線」，但實務上還要回答三件事：
 *
 *   1. **這條路歸誰管** —— 市府、公所與公路單位的路混在一起，
 *      巡查路線要排除不歸自己管的線段，否則覆蓋率永遠達不到
 *   2. **這一段算不算巡查範圍** —— 施工中的路段、私人道路要排除
 *   3. **應巡的點在哪裡** —— 契約常寫「這些路口每週要看一次」，
 *      那是點而不是線，用路線覆蓋率算不出來
 *
 * 所以三張圖資表加一張統計表：
 *   road_lines         道路線段清冊（線）：啟用、顯示名稱、管轄單位
 *   road_blocks        道路區塊（面）：類型、車道、是否納入巡查
 *   patrol_points      應巡查點（點）
 *   patrol_point_stats 覆蓋率的每日快照
 *
 * 統計要落地而不是每次即時算：覆蓋率的計算要掃整天的軌跡點，
 * 一次幾秒鐘 —— 而它是報表與看板每次開啟都要的數字。
 */
export class RoadSetting1757721600000 implements MigrationInterface {
  name = 'RoadSetting1757721600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "road_lines" (
        "id"            SERIAL PRIMARY KEY,
        "company_id"    integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "code"          varchar(40) NOT NULL,
        "road_name"     varchar(100) NOT NULL,
        "display_name"  varchar(100),
        "county"        varchar(10),
        "district"      varchar(10),
        "jurisdiction"  varchar(10) NOT NULL DEFAULT 'CITY',
        "lane_count"    integer NOT NULL DEFAULT 2,
        "length_m"      numeric(10,2) NOT NULL DEFAULT 0,
        "is_active"     boolean NOT NULL DEFAULT true,
        "geom"          geography(LineString, 4326) NOT NULL,
        "remark"        varchar(200),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_road_line_code" UNIQUE ("company_id", "code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_road_line_geom" ON "road_lines" USING GIST ("geom")`);
    // 圖台預設只畫啟用中的線段；部分索引直接對上那個條件
    await queryRunner.query(
      `CREATE INDEX "idx_road_line_active" ON "road_lines" ("company_id", "district") WHERE "is_active" = true`
    );
    // 無名路段的查詢：圖資常有 road_name 是空字串的線段，要挑出來命名
    await queryRunner.query(`CREATE INDEX "idx_road_line_name" ON "road_lines" ("company_id", "road_name")`);

    await queryRunner.query(`
      CREATE TABLE "road_blocks" (
        "id"           SERIAL PRIMARY KEY,
        "company_id"   integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "road_line_id" integer REFERENCES "road_lines"("id") ON DELETE SET NULL,
        "code"         varchar(40) NOT NULL,
        "road_name"    varchar(100) NOT NULL,
        "county"       varchar(10),
        "district"     varchar(10),
        "block_type"   varchar(12) NOT NULL DEFAULT 'MAIN',
        "status"       integer NOT NULL DEFAULT 0,
        "lane_count"   integer NOT NULL DEFAULT 2,
        "width_m"      numeric(6,2),
        "length_m"     numeric(10,2),
        "area_m2"      numeric(12,2),
        "geom"         geography(Polygon, 4326) NOT NULL,
        "remark"       varchar(200),
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_road_block_code" UNIQUE ("company_id", "code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_road_block_geom" ON "road_blocks" USING GIST ("geom")`);
    await queryRunner.query(`CREATE INDEX "idx_road_block_scope" ON "road_blocks" ("company_id", "district", "status")`);

    await queryRunner.query(`
      CREATE TABLE "patrol_points" (
        "id"          SERIAL PRIMARY KEY,
        "company_id"  integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "project_id"  integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "code"        varchar(40) NOT NULL,
        "name"        varchar(100) NOT NULL,
        "county"      varchar(10),
        "district"    varchar(10),
        "road_name"   varchar(100),
        "radius_m"    integer NOT NULL DEFAULT 30,
        "is_active"   boolean NOT NULL DEFAULT true,
        "geom"        geography(Point, 4326) NOT NULL,
        "remark"      varchar(200),
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_patrol_point_code" UNIQUE ("company_id", "code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_patrol_point_geom" ON "patrol_points" USING GIST ("geom")`);
    await queryRunner.query(
      `CREATE INDEX "idx_patrol_point_scope" ON "patrol_points" ("company_id", "district") WHERE "is_active" = true`
    );

    await queryRunner.query(`
      CREATE TABLE "patrol_point_stats" (
        "id"              SERIAL PRIMARY KEY,
        "company_id"      integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "stat_date"       date NOT NULL,
        "project_id"      integer REFERENCES "projects"("id") ON DELETE SET NULL,
        "county"          varchar(10),
        "district"        varchar(10),
        "required_points" integer NOT NULL DEFAULT 0,
        "covered_points"  integer NOT NULL DEFAULT 0,
        "coverage_rate"   numeric(5,2) NOT NULL DEFAULT 0,
        "track_points"    integer NOT NULL DEFAULT 0,
        "updated_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_point_stat" UNIQUE ("company_id", "stat_date", "project_id", "district")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_point_stat_date" ON "patrol_point_stats" ("company_id", "stat_date" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "patrol_point_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patrol_points"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "road_blocks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "road_lines"`);
  }
}
