import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 行政區界線與道路量測。
 *
 * 原本的「行政區」只是案件地址上的一個字串，而界線是從案件位置取凸包推出來的
 * 近似值 —— 那個近似值有兩個問題：沒有案件的區域畫不出來，
 * 而且案件一多，凸包就會把不相鄰的兩塊連成一片。
 *
 * 真正的界線是三層的：縣市 → 鄉鎮市區 → 村里。
 * **里這一層是關鍵**：派工是按里分派的(「這個里歸第一班」)，
 * 而報表上業主要的也是里別統計。只到區的話，一個區有三十個里，
 * 「這件在哪裡」還是答不出來。
 *
 * `road_meas` 是道路的量測資料(編號、長度、寬度)：計價的分母。
 * 與 `road_lines`(圖形)分開，因為量測值來自不同的來源，更新頻率也不同。
 */
export class GisRegion1757980800000 implements MigrationInterface {
  name = 'GisRegion1757980800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "gis_regions" (
        "id"          SERIAL PRIMARY KEY,
        "county_code" varchar(10) NOT NULL,
        "county"      varchar(20) NOT NULL,
        "district_code" varchar(10),
        "district"    varchar(20),
        "village_code" varchar(12),
        "village"     varchar(30),
        "level"       varchar(10) NOT NULL,
        "geom"        geography(Polygon, 4326) NOT NULL,
        "area_km2"    numeric(12,4),
        "note"        varchar(100),
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_gis_region_code" UNIQUE ("level", "county_code", "district_code", "village_code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_gis_region_geom" ON "gis_regions" USING GIST ("geom")`);
    // 依層級查是最常見的用法：圖台要的是「畫出所有區」或「畫出這個區的所有里」
    await queryRunner.query(`CREATE INDEX "idx_gis_region_level" ON "gis_regions" ("level", "county", "district")`);

    await queryRunner.query(`
      CREATE TABLE "road_meas" (
        "id"          SERIAL PRIMARY KEY,
        "county"      varchar(20) NOT NULL,
        "district"    varchar(20),
        "road_num"    varchar(20) NOT NULL,
        "road_name"   varchar(100) NOT NULL,
        "length_m"    numeric(10,2) NOT NULL DEFAULT 0,
        "width_m"     numeric(6,2) NOT NULL DEFAULT 0,
        "lane_count"  integer NOT NULL DEFAULT 2,
        "pavement"    varchar(12) NOT NULL DEFAULT 'AC',
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_road_meas" UNIQUE ("county", "road_num")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_road_meas_name" ON "road_meas" ("county", "road_name")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "road_meas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gis_regions"`);
  }
}
