import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 讓案件歷程可回溯版本。
 *
 * 既有資料要補版本號：直接加欄位而不回填的話，
 * 舊案件的歷程全部會是第 1 版，時間軸就斷在導入這天。
 */
export class VersionedHistory1756598400000 implements MigrationInterface {
  name = 'VersionedHistory1756598400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "case_histories" ADD COLUMN "version" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "case_histories" ADD COLUMN "snapshot" jsonb`);
    await queryRunner.query(`ALTER TABLE "case_histories" ADD COLUMN "changes" jsonb`);

    // 依既有的時間順序補版本號
    await queryRunner.query(`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY case_id ORDER BY created_at, id) AS rn
          FROM case_histories
      )
      UPDATE case_histories h
         SET version = n.rn
        FROM numbered n
       WHERE h.id = n.id
    `);

    // 補上每個案件「目前狀態」的快照到最後一版，讓還原功能對舊資料也可用
    await queryRunner.query(`
      WITH latest AS (
        SELECT DISTINCT ON (case_id) id, case_id
          FROM case_histories
         ORDER BY case_id, version DESC
      )
      UPDATE case_histories h
         SET snapshot = json_build_object(
               'status', c.status,
               'crackType', c.crack_type,
               'roadName', c.road_name,
               'areaM2', c.area_m2::text,
               'photoKey', c.photo_key,
               'projectId', c.project_id,
               'lng', ST_X(c.geom::geometry),
               'lat', ST_Y(c.geom::geometry)
             )::jsonb
        FROM latest l
        JOIN patrol_cases c ON c.id = l.case_id
       WHERE h.id = l.id
    `);

    await queryRunner.query(`CREATE INDEX "idx_history_case_version" ON "case_histories" ("case_id", "version")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_history_case_version"`);
    await queryRunner.query(`ALTER TABLE "case_histories" DROP COLUMN "changes"`);
    await queryRunner.query(`ALTER TABLE "case_histories" DROP COLUMN "snapshot"`);
    await queryRunner.query(`ALTER TABLE "case_histories" DROP COLUMN "version"`);
  }
}
