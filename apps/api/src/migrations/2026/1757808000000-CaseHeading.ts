import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 案件的方位角與原始座標。
 *
 * 車機的天線裝在車頂，回報的是**車輛的位置**，而破壞在鏡頭正前方約 5 公尺。
 * 不校正的話，地圖上的點會系統性地偏在道路後方 —— 派工人員到現場
 * 沿著路走過去會找不到那個坑。
 *
 * 校正需要方位角，所以要存；校正後的值寫進 `longitude`/`latitude`/`geom`，
 * **原始值另存一份**：校正的假設(天線在車頂、破壞在正前方 5 公尺)
 * 不見得每種車機都成立，出事時要回得去。
 */
export class CaseHeading1757808000000 implements MigrationInterface {
  name = 'CaseHeading1757808000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patrol_cases"
        ADD COLUMN "heading"       real,
        ADD COLUMN "raw_longitude" double precision,
        ADD COLUMN "raw_latitude"  double precision
    `);

    // 既有案件沒有經過校正，原始座標就是現在的座標
    await queryRunner.query(
      `UPDATE "patrol_cases" SET "raw_longitude" = "longitude", "raw_latitude" = "latitude" WHERE "raw_longitude" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patrol_cases"
        DROP COLUMN IF EXISTS "heading",
        DROP COLUMN IF EXISTS "raw_longitude",
        DROP COLUMN IF EXISTS "raw_latitude"
    `);
  }
}
