import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 三層組織與授權傳遞。
 *
 * 平台 → 廠商 → 外包。每一層只看得到自己的子樹，
 * 而且開不出自己沒有的權限。
 *
 * 公司用**自關聯**而不是三張表：三層的規則完全一樣（開通、停用、往下傳遞），
 * 拆三張表會讓同一段邏輯抄三遍，加第四層時再抄一次。
 *
 * 授權存成「一列一個動作鍵」而不是一個陣列欄位：
 * 要記「是誰、哪個單位、什麼時候開的」，而且收回時要能只停用其中一項。
 */
export class CompanyTiers1757030400000 implements MigrationInterface {
  name = 'CompanyTiers1757030400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        ADD COLUMN "parent_id"   integer REFERENCES "companies"("id") ON DELETE CASCADE,
        ADD COLUMN "tier"        integer NOT NULL DEFAULT 2,
        ADD COLUMN "user_limit"  integer NOT NULL DEFAULT 10,
        ADD COLUMN "is_active"   boolean NOT NULL DEFAULT true,
        ADD COLUMN "description" varchar(100),
        ADD COLUMN "created_at"  timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN "updated_at"  timestamptz NOT NULL DEFAULT now()
    `);

    // 子樹查詢是每個請求都會做的事(權限收斂)，索引直接對上遞迴 CTE 的形狀
    await queryRunner.query(`CREATE INDEX "idx_company_parent" ON "companies" ("parent_id")`);
    await queryRunner.query(`CREATE INDEX "idx_company_tier" ON "companies" ("tier", "is_active")`);

    // 既有的公司都是「第二層但沒有上層」，直接加約束會被自己的資料擋下。
    // 所以先補一個平台層，再把現有公司掛上去 —— 加約束前一定要先讓資料合法，
    // 這是所有「事後補上約束」的 migration 都要處理的那一步
    await queryRunner.query(`
      INSERT INTO "companies" ("code", "name", "tier", "user_limit", "is_active", "description")
      SELECT 'ROOT', '系統營運方', 1, 5, true, '開通廠商單位的模組與人員額度'
       WHERE NOT EXISTS (SELECT 1 FROM "companies" WHERE "tier" = 1)
    `);

    await queryRunner.query(`
      UPDATE "companies"
         SET "parent_id" = (SELECT "id" FROM "companies" WHERE "tier" = 1 ORDER BY "id" LIMIT 1)
       WHERE "tier" <> 1 AND "parent_id" IS NULL
    `);

    // 層級必須合法：平台沒有上層，其餘一定要有 ——
    // 沒有上層的廠商不會有人幫它開通，那是個永遠停在空權限的孤兒單位
    await queryRunner.query(`
      ALTER TABLE "companies"
        ADD CONSTRAINT "ck_company_tier" CHECK (
          (tier = 1 AND parent_id IS NULL) OR (tier IN (2, 3) AND parent_id IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "company_grants" (
        "id"                      SERIAL PRIMARY KEY,
        "company_id"              integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "action_key"              varchar(40) NOT NULL,
        "is_active"               boolean NOT NULL DEFAULT true,
        "granted_by_company_id"   integer REFERENCES "companies"("id") ON DELETE SET NULL,
        "granted_by"              integer REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        "updated_at"              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_company_grant" UNIQUE ("company_id", "action_key")
      )
    `);

    // 每次登入與續期都要算「角色 ∩ 公司開通」，所以索引對著這個查詢
    await queryRunner.query(`CREATE INDEX "idx_company_grant_active" ON "company_grants" ("company_id", "is_active")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "company_grants"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "ck_company_tier"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_company_tier"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_company_parent"`);
    await queryRunner.query(`
      ALTER TABLE "companies"
        DROP COLUMN IF EXISTS "parent_id",
        DROP COLUMN IF EXISTS "tier",
        DROP COLUMN IF EXISTS "user_limit",
        DROP COLUMN IF EXISTS "is_active",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "created_at",
        DROP COLUMN IF EXISTS "updated_at"
    `);
  }
}
