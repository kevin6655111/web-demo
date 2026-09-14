import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 帳號安全與人員資料。
 *
 * 四件事一起做，因為它們都圍著同一張 `users` 表：
 *   1. 人員欄位 —— 部門、主管、員工編號、職稱、任職期間、系統首頁、頭像、帳號到期
 *   2. 密碼歷史 —— 「不可與最近三次相同」需要留下舊雜湊；24 小時冷卻需要記上次修改時間
 *   3. 個人授權覆蓋 —— 角色之外對單一使用者額外開啟或明確撤銷某個功能
 *   4. API Key —— 車機與對接系統不該拿人的帳號登入；金鑰只存雜湊，遺失了就換一把
 *
 * `employee_no` 用部分唯一索引：舊資料沒有編號，不能讓所有 NULL 互相撞。
 */
export class AccountSecurityAndProfile1757462400000 implements MigrationInterface {
  name = 'AccountSecurityAndProfile1757462400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "departments" (
        "id"         SERIAL PRIMARY KEY,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "parent_id"  integer REFERENCES "departments"("id") ON DELETE SET NULL,
        "key"        varchar(20) NOT NULL,
        "name"       varchar(50) NOT NULL,
        "is_active"  boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_department_company_key" UNIQUE ("company_id", "key")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "department_id"        integer REFERENCES "departments"("id") ON DELETE SET NULL,
        ADD COLUMN "manager_id"           integer REFERENCES "users"("id") ON DELETE SET NULL,
        ADD COLUMN "employee_no"          varchar(20),
        ADD COLUMN "english_name"         varchar(60),
        ADD COLUMN "email"                varchar(120),
        ADD COLUMN "job_title"            varchar(40),
        ADD COLUMN "hire_date"            date,
        ADD COLUMN "leave_date"           date,
        ADD COLUMN "home_sys"             varchar(20),
        ADD COLUMN "avatar_path"          varchar(255),
        ADD COLUMN "expire_at"            timestamptz,
        ADD COLUMN "password_changed_at"  timestamptz,
        ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false
    `);

    // 舊帳號視為「剛改過密碼」：否則升級當天所有人都會被要求改密碼
    await queryRunner.query(`UPDATE "users" SET "password_changed_at" = now() WHERE "password_changed_at" IS NULL`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_company_employee_no" ON "users" ("company_id", "employee_no") WHERE "employee_no" IS NOT NULL`
    );
    await queryRunner.query(`CREATE INDEX "idx_user_department" ON "users" ("department_id")`);

    await queryRunner.query(`
      CREATE TABLE "password_histories" (
        "id"            SERIAL PRIMARY KEY,
        "user_id"       integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "password_hash" varchar(100) NOT NULL,
        "created_at"    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_password_history_user" ON "password_histories" ("user_id", "created_at" DESC)`
    );

    await queryRunner.query(`
      CREATE TABLE "user_action_overrides" (
        "id"         SERIAL PRIMARY KEY,
        "user_id"    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "action_key" varchar(40) NOT NULL,
        "is_granted" boolean NOT NULL,
        "reason"     varchar(200),
        "granted_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_action_override" UNIQUE ("user_id", "action_key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id"           SERIAL PRIMARY KEY,
        "company_id"   integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"         varchar(60) NOT NULL,
        "prefix"       varchar(12) NOT NULL,
        "key_hash"     varchar(64) NOT NULL,
        "scopes"       text[] NOT NULL DEFAULT '{}',
        "is_active"    boolean NOT NULL DEFAULT true,
        "last_used_at" timestamptz,
        "expires_at"   timestamptz,
        "created_by"   integer REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_api_key_hash" UNIQUE ("key_hash")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_api_key_company" ON "api_keys" ("company_id", "is_active")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "api_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_action_overrides"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "password_histories"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_department"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_user_company_employee_no"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "department_id",
        DROP COLUMN IF EXISTS "manager_id",
        DROP COLUMN IF EXISTS "employee_no",
        DROP COLUMN IF EXISTS "english_name",
        DROP COLUMN IF EXISTS "email",
        DROP COLUMN IF EXISTS "job_title",
        DROP COLUMN IF EXISTS "hire_date",
        DROP COLUMN IF EXISTS "leave_date",
        DROP COLUMN IF EXISTS "home_sys",
        DROP COLUMN IF EXISTS "avatar_path",
        DROP COLUMN IF EXISTS "expire_at",
        DROP COLUMN IF EXISTS "password_changed_at",
        DROP COLUMN IF EXISTS "must_change_password"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "departments"`);
  }
}
