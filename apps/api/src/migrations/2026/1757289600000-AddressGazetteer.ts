import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 門牌圖資。
 *
 * 在此之前，案件的路名由座標雜湊產生 —— 結果穩定但並非真實地址，
 * 無法用於公文、計價對帳或現場導航。
 *
 * 門牌獨立成表而非附掛於案件：同一個門牌會被大量案件引用，
 * 且地址自動完成需要對全部門牌搜尋，而非僅限出現過案件的地址。
 */
export class AddressGazetteer1757289600000 implements MigrationInterface {
  name = 'AddressGazetteer1757289600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "address_points" (
        "id"           SERIAL PRIMARY KEY,
        "county"       varchar(10)  NOT NULL,
        "district"     varchar(10)  NOT NULL,
        "cavlge"       varchar(10),
        "road"         varchar(50)  NOT NULL,
        "number"       varchar(20)  NOT NULL,
        "full_address" varchar(120) NOT NULL,
        "geom"         geography(Point, 4326) NOT NULL,
        "updated_at"   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_address_point" UNIQUE ("county", "district", "cavlge", "road", "number")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_address_point_road" ON "address_points" ("county", "district", "road")`);
    await queryRunner.query(`CREATE INDEX "idx_address_point_geom" ON "address_points" USING GIST ("geom")`);

    // 自動完成以路名做前後模糊比對，B-tree 索引對 '%關鍵字%' 無效。
    // trigram 索引可支援任意位置的比對；擴充在多數 PostgreSQL 發行版中隨附。
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE INDEX "idx_address_point_road_trgm" ON "address_points" USING GIN ("road" gin_trgm_ops)`);

    await queryRunner.query(`
      CREATE TABLE "address_grids" (
        "id"          SERIAL PRIMARY KEY,
        "grid_x"      integer NOT NULL,
        "grid_y"      integer NOT NULL,
        "point_count" integer NOT NULL DEFAULT 0,
        "loaded_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_address_grid" UNIQUE ("grid_x", "grid_y")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "address_grids"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "address_points"`);
    // pg_trgm 不移除：其他索引可能也依賴它
  }
}
