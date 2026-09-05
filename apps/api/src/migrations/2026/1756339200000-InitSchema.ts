import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 初始 schema。
 *
 * 手寫而非 typeorm 產生，因為要在建表前先開 PostGIS extension，
 * 也要讓 external_id 的唯一鍵與 geom 的 GiST 索引意圖清楚可讀。
 */
export class InitSchema1756339200000 implements MigrationInterface {
  name = 'InitSchema1756339200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id"   SERIAL PRIMARY KEY,
        "code" varchar(10) NOT NULL,
        "name" varchar(50) NOT NULL,
        CONSTRAINT "uq_company_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"      SERIAL PRIMARY KEY,
        "key"     varchar(20) NOT NULL,
        "name"    varchar(50) NOT NULL,
        "actions" text[] NOT NULL DEFAULT '{}',
        CONSTRAINT "uq_role_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            SERIAL PRIMARY KEY,
        "company_id"    integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "role_id"       integer REFERENCES "roles"("id") ON DELETE SET NULL,
        "account"       varchar(30) NOT NULL,
        "password"      varchar(100) NOT NULL,
        "name"          varchar(30) NOT NULL,
        "active"        boolean NOT NULL DEFAULT true,
        "last_login_at" timestamptz,
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_company_account" UNIQUE ("company_id", "account")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_user_company_id" ON "users" ("company_id")`);

    await queryRunner.query(`
      CREATE TABLE "patrol_cases" (
        "id"          SERIAL PRIMARY KEY,
        "company_id"  integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "reporter_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "external_id" varchar(60) NOT NULL,
        "crack_type"  varchar(20) NOT NULL,
        "status"      varchar(20) NOT NULL DEFAULT 'NEW',
        "geom"        geography(Point,4326) NOT NULL,
        "road_name"   varchar(100),
        "area_m2"     numeric(8,2) NOT NULL DEFAULT 0,
        "photo_key"   varchar(200),
        "detected_at" timestamptz NOT NULL,
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_case_external_id" UNIQUE ("external_id")
      )
    `);

    // 空間索引：ST_DWithin 靠這條才不會全表掃描
    await queryRunner.query(`CREATE INDEX "idx_case_geom" ON "patrol_cases" USING GIST ("geom")`);
    await queryRunner.query(`CREATE INDEX "idx_case_company_status" ON "patrol_cases" ("company_id", "status")`);
    await queryRunner.query(`CREATE INDEX "idx_case_detected_at" ON "patrol_cases" ("detected_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "patrol_cases"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
