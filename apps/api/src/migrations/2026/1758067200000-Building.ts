import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 建物量體。
 *
 * 巡查系統為什麼需要建物：**判斷施工影響範圍**。
 * 一個要封街刨鋪的路段，旁邊是住宅還是廠區，決定施工時段與交維方式 ——
 * 而那個判斷在只有道路的地圖上做不出來。
 *
 * 只存輪廓與樓高，不存室內資訊：這裡要回答的是「這塊地上有多大的量體」，
 * 而不是「這棟樓裡有誰」。
 */
export class Building1758067200000 implements MigrationInterface {
  name = 'Building1758067200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "buildings" (
        "id"          SERIAL PRIMARY KEY,
        "osm_id"      varchar(30),
        "county"      varchar(20),
        "district"    varchar(20),
        "name"        varchar(100),
        "usage"       varchar(16) NOT NULL DEFAULT 'RESIDENTIAL',
        "levels"      integer NOT NULL DEFAULT 1,
        "height_m"    numeric(6,2),
        "area_m2"     numeric(12,2),
        "geom"        geography(Polygon, 4326) NOT NULL,
        "created_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_building_geom" ON "buildings" USING GIST ("geom")`);
    await queryRunner.query(`CREATE INDEX "idx_building_scope" ON "buildings" ("county", "district")`);
    // 匯入來源可能重複送同一棟；有 osm_id 的才需要唯一
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_building_osm" ON "buildings" ("osm_id") WHERE "osm_id" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "buildings"`);
  }
}
