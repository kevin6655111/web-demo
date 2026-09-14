import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 報表種類。
 *
 * 原本只有一種報表(案件清單)，所以 `report_jobs` 不需要記「這是哪一種」。
 * 加上車巡日報、月報、坑洞、路段、軌跡、薪資與四種鋪面報表之後，
 * 同一張表要區分十一種產出 —— 而去重鍵也必須把種類算進去，
 * 否則「同一個月的月報」與「同一個月的薪資表」會被當成同一份工作。
 *
 * 既有資料一律視為案件清單：那是導入這個欄位之前唯一存在的種類。
 */
export class ReportKind1757635200000 implements MigrationInterface {
  name = 'ReportKind1757635200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "report_jobs" ADD COLUMN "kind" varchar(20) NOT NULL DEFAULT 'CASE_LIST'`);
    await queryRunner.query(`ALTER TABLE "report_jobs" ADD COLUMN "title" varchar(60)`);

    // 舊的去重鍵沒有把種類算進去；重算成本高且沒有意義 ——
    // 直接清掉去重鍵讓它重新累積，既有工作的檔案與狀態都保留
    await queryRunner.query(`UPDATE "report_jobs" SET "dedup_key" = "dedup_key" || ':CASE_LIST'`);

    await queryRunner.query(`CREATE INDEX "idx_report_kind" ON "report_jobs" ("company_id", "kind")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_report_kind"`);
    await queryRunner.query(`ALTER TABLE "report_jobs" DROP COLUMN IF EXISTS "title"`);
    await queryRunner.query(`ALTER TABLE "report_jobs" DROP COLUMN IF EXISTS "kind"`);
  }
}
