import 'reflect-metadata';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { InitialSchema1751000000000 } from '../src/database/migrations/1751000000000-InitialSchema';

/**
 * Test-database bootstrap. Creates and migrates a dedicated `ggee_test` database so the E2E suite
 * never touches the app's `ggee` database, and provides a TRUNCATE helper to reset state.
 *
 * All connection settings are read from process.env at call time, so the caller must set the
 * DATABASE_* variables before invoking these helpers.
 */

export const TEST_DB_NAME = 'ggee_test';

const APP_TABLES = [
  'users',
  'user_sessions',
  'protects',
  'protect_target_indexing_outbox',
  'audits',
  'strategy_chat_rooms',
  'strategy_chat_messages',
];

function pgConfig(database: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  return {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5433),
    user: process.env.DATABASE_USERNAME ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? 'password',
    database,
  };
}

/** Connect to the maintenance `postgres` db and create `ggee_test` if it does not exist. */
export async function ensureTestDatabase(): Promise<void> {
  const admin = new Client(pgConfig('postgres'));
  await admin.connect();
  try {
    const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB_NAME]);
    if (res.rowCount === 0) {
      // CREATE DATABASE cannot run inside a transaction; run it standalone.
      await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }
}

/** Run the TypeORM migrations against `ggee_test` (idempotent: skipped if already applied). */
export async function runMigrations(): Promise<void> {
  const cfg = pgConfig(TEST_DB_NAME);
  const ds = new DataSource({
    type: 'postgres',
    host: cfg.host,
    port: cfg.port,
    username: cfg.user,
    password: cfg.password,
    database: cfg.database,
    entities: [],
    migrations: [InitialSchema1751000000000],
    synchronize: false,
  });
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

/** Clear every app table (used once in beforeAll to isolate a run). */
export async function truncateAll(): Promise<void> {
  const c = new Client(pgConfig(TEST_DB_NAME));
  await c.connect();
  try {
    const list = APP_TABLES.map((t) => `"${t}"`).join(', ');
    await c.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  } finally {
    await c.end();
  }
}
