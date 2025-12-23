import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginCountToProfiles1764000000000 implements MigrationInterface {
  name = 'AddLoginCountToProfiles1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profiles"
      ADD COLUMN IF NOT EXISTS "login_count" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profiles"
      DROP COLUMN IF EXISTS "login_count"
    `);
  }
}











