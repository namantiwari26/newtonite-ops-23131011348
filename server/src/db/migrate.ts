import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, withTransaction } from './pool.js';

// Resolve directory paths in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isTest = process.env.NODE_ENV === 'test';
const log = (...args: any[]) => {
  if (!isTest) console.log(...args);
};
const warn = (...args: any[]) => {
  if (!isTest) console.warn(...args);
};

export async function runMigrations(): Promise<void> {
  log('[Migration Runner] Checking and executing plain SQL migrations...');

  // Ensure migration tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Locate migrations directory (checking local, dist fallback, and src)
  let migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.join(__dirname, '../../src/db/migrations');
  }
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.join(process.cwd(), 'src/db/migrations');
  }

  if (!fs.existsSync(migrationsDir)) {
    warn(`[Migration Runner] Directory not found: ${migrationsDir}`);
    return;
  }

  // Read all SQL files and sort numerically / alphabetically
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Retrieve already applied migrations
  const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));

  for (const file of migrationFiles) {
    if (!applied.has(file)) {
      log(`[Migration Runner] Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');

      // Execute each migration inside a dedicated transaction
      await withTransaction(async (client) => {
        await client.query(sqlContent);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      });

      log(`[Migration Runner] Successfully applied: ${file}`);
    } else {
      log(`[Migration Runner] Already applied: ${file}`);
    }
  }

  log('[Migration Runner] All migrations are up to date.');
}

// Allow direct execution: `tsx src/db/migrate.ts`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration Runner Error]:', err);
      process.exit(1);
    });
}
