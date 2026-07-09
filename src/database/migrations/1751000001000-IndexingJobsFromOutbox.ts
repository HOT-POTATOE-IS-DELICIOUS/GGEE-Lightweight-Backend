import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `protect_target_indexing_outbox` -> `indexing_jobs`.
 *
 * The transactional-outbox pattern died when the dispatch scheduler was replaced by a synchronous
 * HTTP call to the crawler: nothing claims rows and nothing retries them, so `claimed_at`,
 * `published_at`, the IN_PROGRESS/PUBLISHED states and the dispatcher's `(status, createdAt)` index
 * were all dead weight. What survives is a plain job table: id, target, terminal status.
 *
 * Legacy rows are folded into the new state machine — anything mid-flight becomes PENDING, and
 * COMPLETED is preserved. PUBLISHED rows that never got their `all_done` callback stay PENDING and
 * will time out at the waiter's ceiling, same as before.
 */
export class IndexingJobsFromOutbox1751000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_protect_target_indexing_outbox_status_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "protect_target_indexing_outbox" RENAME TO "indexing_jobs"`,
    );
    await queryRunner.query(`ALTER TABLE "indexing_jobs" DROP COLUMN "claimed_at"`);
    await queryRunner.query(`ALTER TABLE "indexing_jobs" DROP COLUMN "published_at"`);
    await queryRunner.query(
      `UPDATE "indexing_jobs" SET "status" = 'PENDING' WHERE "status" IN ('IN_PROGRESS', 'PUBLISHED')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "indexing_jobs" ADD COLUMN "claimed_at" TIMESTAMP NULL`);
    await queryRunner.query(`ALTER TABLE "indexing_jobs" ADD COLUMN "published_at" TIMESTAMP NULL`);
    // FAILED has no pre-rename equivalent; PENDING is the closest lossless landing spot.
    await queryRunner.query(
      `UPDATE "indexing_jobs" SET "status" = 'PENDING' WHERE "status" = 'FAILED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "indexing_jobs" RENAME TO "protect_target_indexing_outbox"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_protect_target_indexing_outbox_status_created_at" ON "protect_target_indexing_outbox" ("status", "createdAt")`,
    );
  }
}
