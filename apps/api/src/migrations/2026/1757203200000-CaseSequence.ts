import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 案件編號的流水號表。
 *
 * 在這之前，取下一個號是「`SELECT MAX(case_num)` 再 `INSERT`」——
 * 兩步之間別人也可能讀到同一個 MAX，所以要靠唯一鍵擋下來再重試。
 * 低流量下看不出差別，但車機是整批上傳的：一次五十筆同時進來，
 * 那個重試迴圈會退避到逾時。
 *
 * 改成一張計數器表之後，取號是單一敘述的
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` —— 讀改寫由資料庫在
 * 同一個敘述裡完成，同時進來一百個請求會拿到一百個不同的號。
 *
 * **建表之後一定要回填**：舊資料的單號已經發到某個號碼，計數器從 0 開始的話，
 * 下一張單會直接撞上舊的。下面的三段 INSERT 就是在做這件事。
 */
export class CaseSequence1757203200000 implements MigrationInterface {
  name = 'CaseSequence1757203200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "case_sequences" (
        "prefix"      varchar(20) NOT NULL,
        "seq_date"    varchar(6)  NOT NULL,
        "last_number" integer     NOT NULL DEFAULT 0,
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_case_sequence" PRIMARY KEY ("prefix", "seq_date")
      )
    `);

    // ─── 回填：派工單與巡查單 ─────────────────────────────────
    //
    // 單號格式為 <標案號+類型 8 碼><年月 YYMM 4 碼><流水 4 碼>，
    // 例如 DEMO01PA26090001。以 (前綴, 年月) 為單位取最大流水號作為計數器起點。
    for (const table of ['work_orders', 'maintenances']) {
      await queryRunner.query(`
        INSERT INTO "case_sequences" ("prefix", "seq_date", "last_number")
        SELECT LEFT("case_num", 8),
               SUBSTRING("case_num" FROM 9 FOR 4),
               MAX(RIGHT("case_num", 4)::int)
          FROM "${table}"
         WHERE "case_num" ~ '^.{8}[0-9]{8}$'
         GROUP BY 1, 2
        ON CONFLICT ("prefix", "seq_date")
        DO UPDATE SET "last_number" = GREATEST("case_sequences"."last_number", EXCLUDED."last_number")
      `);
    }

    // ─── 車巡案件：先補上缺的編號 ─────────────────────────────
    //
    // 案件過去是「插入時不編號」的，於是有一批 case_num 是 NULL ——
    // 那些案件在畫面上只能顯示外部系統的編號，報表也對不到。
    // 這裡照既有格式（標案號 + 六位流水）補完。
    await queryRunner.query(`
      WITH numbered AS (
        SELECT c."id",
               p."prj_id" AS prj,
               COALESCE((SELECT MAX(RIGHT(c2."case_num", 6)::int)
                           FROM "patrol_cases" c2
                          WHERE c2."project_id" = c."project_id"
                            AND c2."case_num" ~ '^.+[0-9]{6}$'), 0)
               + ROW_NUMBER() OVER (PARTITION BY c."project_id" ORDER BY c."id") AS n
          FROM "patrol_cases" c
          JOIN "projects" p ON p."id" = c."project_id"
         WHERE c."case_num" IS NULL
      )
      UPDATE "patrol_cases" t
         SET "case_num" = n.prj || LPAD(n.n::text, 6, '0')
        FROM numbered n
       WHERE t."id" = n."id"
    `);

    // 車巡案件不分日期，計數器以 '-' 作為 seq_date（主鍵不接受 NULL）
    await queryRunner.query(`
      INSERT INTO "case_sequences" ("prefix", "seq_date", "last_number")
      SELECT p."prj_id", '-', MAX(RIGHT(c."case_num", 6)::int)
        FROM "patrol_cases" c
        JOIN "projects" p ON p."id" = c."project_id"
       WHERE c."case_num" ~ '^.+[0-9]{6}$'
       GROUP BY p."prj_id"
      ON CONFLICT ("prefix", "seq_date")
      DO UPDATE SET "last_number" = GREATEST("case_sequences"."last_number", EXCLUDED."last_number")
    `);

    // 補完之後就不該再有沒編號的案件
    await queryRunner.query(`
      ALTER TABLE "patrol_cases"
        ADD CONSTRAINT "ck_patrol_case_num_present" CHECK ("case_num" IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patrol_cases" DROP CONSTRAINT IF EXISTS "ck_patrol_case_num_present"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "case_sequences"`);
    // 補上的案件編號不還原：那是資料的修正，不是這次 migration 才有的結構
  }
}
