import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the NestJS migration. Equivalent to the original `schema.sql`
 * (Snowflake bigint PKs, quoted "createdAt", soft-delete columns, partial unique indexes).
 */
export class InitialSchema1751000000000 implements MigrationInterface {
  name = 'InitialSchema1751000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" BIGINT PRIMARY KEY,
        "email" VARCHAR(255) NOT NULL,
        "password" VARCHAR(255) NOT NULL,
        "role" VARCHAR(32) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uniq_users_email" ON "users" ("email")`);

    // user_sessions
    await queryRunner.query(`
      CREATE TABLE "user_sessions" (
        "id" BIGINT PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "session_id" VARCHAR(64) NOT NULL,
        "refresh_token_hash" CHAR(64) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uniq_user_sessions_session_id" ON "user_sessions" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_sessions_user_id" ON "user_sessions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uniq_user_sessions_user_active" ON "user_sessions" ("user_id") WHERE deleted = false`,
    );

    // protects
    await queryRunner.query(`
      CREATE TABLE "protects" (
        "id" BIGINT PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "target" VARCHAR(255) NOT NULL,
        "info" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(`CREATE INDEX "idx_protects_user_id" ON "protects" ("user_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uniq_protects_user_active" ON "protects" ("user_id") WHERE deleted = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_protects_target_info_active" ON "protects" ("target", "info") WHERE deleted = false`,
    );

    // protect_target_indexing_outbox
    await queryRunner.query(`
      CREATE TABLE "protect_target_indexing_outbox" (
        "id" BIGINT PRIMARY KEY,
        "protect_target" VARCHAR(255) NOT NULL,
        "protect_target_info" VARCHAR(255) NOT NULL,
        "status" VARCHAR(32) NOT NULL,
        "claimed_at" TIMESTAMP NULL,
        "published_at" TIMESTAMP NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_protect_target_indexing_outbox_status_created_at" ON "protect_target_indexing_outbox" ("status", "createdAt")`,
    );

    // audits
    await queryRunner.query(`
      CREATE TABLE "audits" (
        "id" BIGINT PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "protect_target" VARCHAR(255) NOT NULL,
        "protect_target_info" VARCHAR(255) NOT NULL,
        "text" TEXT NOT NULL,
        "reviews_json" TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_audits_user_id_created_at" ON "audits" ("user_id", "createdAt")`,
    );

    // strategy_chat_rooms
    await queryRunner.query(`
      CREATE TABLE "strategy_chat_rooms" (
        "id" BIGINT PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "title" VARCHAR(20) NOT NULL,
        "last_chatted_at" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_strategy_chat_rooms_user_id" ON "strategy_chat_rooms" ("user_id", "createdAt")`,
    );

    // strategy_chat_messages
    await queryRunner.query(`
      CREATE TABLE "strategy_chat_messages" (
        "id" BIGINT PRIMARY KEY,
        "room_id" BIGINT NOT NULL,
        "role" VARCHAR(16) NOT NULL,
        "content" TEXT NOT NULL,
        "intent" VARCHAR(255) NULL,
        "refined_query" VARCHAR(512) NULL,
        "meta_json" JSONB NULL,
        "ai_message_id" VARCHAR(32) NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "deleted_at" TIMESTAMP NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_strategy_chat_messages_room_id" ON "strategy_chat_messages" ("room_id", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "strategy_chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "strategy_chat_rooms"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "protect_target_indexing_outbox"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "protects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
