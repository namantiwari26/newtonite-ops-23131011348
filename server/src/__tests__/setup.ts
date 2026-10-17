import pg from 'pg';
import { beforeAll, beforeEach, afterAll } from 'vitest';

// 1. Point DATABASE_URL strictly to the separate test database: workdesk_test
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://workdesk:workdesk_secret@localhost:5432/workdesk_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_minimum_32_characters';
process.env.SEED_ITEMS = process.env.SEED_ITEMS || '100';

// 2. Connect to postgres server to create workdesk_test if it does not already exist
const adminClient = new pg.Client({
  connectionString: 'postgres://workdesk:workdesk_secret@localhost:5432/postgres',
});

try {
  await adminClient.connect();
  const dbCheck = await adminClient.query(
    "SELECT 1 FROM pg_database WHERE datname = 'workdesk_test'"
  );
  if (dbCheck.rowCount === 0) {
    console.log('[Test Setup] Creating separate test database: workdesk_test...');
    await adminClient.query('CREATE DATABASE workdesk_test;');
  }
} catch (err: any) {
  console.error('[Test Setup DB Error]:', err.message);
} finally {
  await adminClient.end().catch(() => {});
}

// 3. Dynamically import pool, runMigrations, and seedData after setting DATABASE_URL
const { pool } = await import('../db/pool.js');
const { runMigrations } = await import('../db/migrate.js');
const { seedData } = await import('../db/seed.js');

// 4. Run migrations once on workdesk_test
beforeAll(async () => {
  const currentDb = await pool.query<{ current_database: string }>('SELECT current_database();');
  console.log(
    `[Test Setup] Connected to isolated test database: ${currentDb.rows[0].current_database}`
  );
  await runMigrations();
  await seedData();
});

// 5. Truncate tables between tests and re-seed to guarantee test isolation
beforeEach(async () => {
  await pool.query(`
    TRUNCATE TABLE comments, outbox_events, activity_events, idempotency_keys, work_items, team_memberships, teams, users CASCADE;
  `);
  await seedData();
});

// 6. Graceful cleanup after all tests complete
afterAll(async () => {
  if (!(pool as any).ending && !(pool as any).ended) {
    await pool.end();
  }
});
