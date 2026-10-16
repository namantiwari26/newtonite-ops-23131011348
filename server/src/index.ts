import { app } from './app.js';
import { runMigrations } from './db/migrate.js';
import { seedData } from './db/seed.js';
import { startOutboxWorker } from './worker/outboxWorker.js';
import { getJwtSecret } from './controllers/authController.js';
import { pool } from './db/pool.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

async function startServer() {
  try {
    // 1. Verify JWT_SECRET is configured in environment (Task 1: refuse to start without it)
    getJwtSecret();

    // 2. Ensure migrations are applied before accepting requests
    await runMigrations();

    // 3. Auto-seed if database is fresh (0 users)
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) as count FROM users');
    if (parseInt(rows[0]?.count || '0', 10) === 0) {
      console.log('[Workdesk Server] Empty database detected. Running seedData()...');
      await seedData();
    }

    // 3. Start HTTP server
    const server = app.listen(PORT, () => {
      console.log(`[Workdesk Server] Listening on http://localhost:${PORT}`);
    });

    // 4. Start Transactional Outbox worker loop
    const worker = startOutboxWorker(3000);

    // 5. Graceful shutdown handler
    const shutdown = () => {
      console.log('[Workdesk Server] Shutting down gracefully...');
      worker.stop();
      server.close(() => {
        console.log('[Workdesk Server] Closed HTTP server.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err: any) {
    console.error('[Workdesk Server Startup Error]:', err?.message || err);
    process.exit(1);
  }
}

startServer();
