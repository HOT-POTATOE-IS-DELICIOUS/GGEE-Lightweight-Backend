import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index for the retention sweep. Without it, the periodic
 * `DELETE FROM indexing_jobs WHERE "createdAt" < ?` seq-scans a table that the 30-minute refresh
 * grows by one row per protect target, forever.
 */
export class IndexingJobsCreatedAtIndex1751000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_indexing_jobs_created_at" ON "indexing_jobs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_indexing_jobs_created_at"`);
  }
}
