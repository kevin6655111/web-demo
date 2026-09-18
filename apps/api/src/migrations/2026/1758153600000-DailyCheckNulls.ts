import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 每日檢查的唯一鍵要把 NULL 當成同一個值。
 *
 * 原本的檢查只看得到「有案件的車」—— 一台出了車卻一筆都沒上傳的車
 * 根本不會出現在清單上，而那正是督導最需要看到的那一台。
 *
 * 改成連沒有案件的車也要列出來之後，這種列的 `project_id` 與 `district`
 * 是 NULL（沒有案件就沒有標案與行政區可以歸屬）。而 Postgres 預設
 * **NULL 彼此不相等**，於是 `ON CONFLICT` 永遠不會命中 ——
 * 每小時的排程會替同一台車再插一列，一天疊出 24 列一模一樣的「未出車」。
 *
 * `NULLS NOT DISTINCT`（PG 15+）讓 NULL 互相視為相同，upsert 才會命中。
 */
export class DailyCheckNulls1758153600000 implements MigrationInterface {
  name = 'DailyCheckNulls1758153600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 先清掉舊規則下已經疊出來的重複列，只留每組最新的那一筆；
    // 不先清的話新約束會被既有資料擋下
    await queryRunner.query(`
      DELETE FROM "daily_checks" a
       USING "daily_checks" b
       WHERE a.id < b.id
         AND a.company_id = b.company_id
         AND a.check_date = b.check_date
         AND a.car = b.car
         AND a.project_id IS NOT DISTINCT FROM b.project_id
         AND a.district IS NOT DISTINCT FROM b.district
    `);

    await queryRunner.query(`ALTER TABLE "daily_checks" DROP CONSTRAINT IF EXISTS "uq_daily_check"`);
    await queryRunner.query(`
      ALTER TABLE "daily_checks"
        ADD CONSTRAINT "uq_daily_check"
        UNIQUE NULLS NOT DISTINCT ("company_id", "check_date", "project_id", "car", "district")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 有損：退回舊約束之後，NULL 組合會再次變成可重複
    await queryRunner.query(`ALTER TABLE "daily_checks" DROP CONSTRAINT IF EXISTS "uq_daily_check"`);
    await queryRunner.query(`
      ALTER TABLE "daily_checks"
        ADD CONSTRAINT "uq_daily_check"
        UNIQUE ("company_id", "check_date", "project_id", "car", "district")
    `);
  }
}
