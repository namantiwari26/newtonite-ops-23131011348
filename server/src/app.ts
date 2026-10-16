import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { authMiddleware } from './middleware/auth.js';
import { requireIdempotency } from './middleware/idempotency.js';
import {
  listItems,
  getItemById,
  createItem,
  claimItem,
  updateItem,
  resolveItem,
  transitionItem,
  deleteItem,
  addComment,
} from './controllers/itemsController.js';
import { pool } from './db/pool.js';
import { processOutboxBatch } from './worker/outboxWorker.js';
import { login, getCurrentUser } from './controllers/authController.js';

export const app = express();

// 1. Basic middleware
app.use(cors());
app.use(express.json());

// 2. Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'workdesk-api', timestamp: new Date().toISOString() });
});

// 3. Authentication endpoints
app.post('/api/auth/login', login);
app.post('/api/login', login);
app.get('/api/auth/me', authMiddleware, getCurrentUser);

// 4. Metadata endpoints
app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_admin, 
              COALESCE(json_agg(json_build_object('team_id', tm.team_id, 'role', tm.role)) FILTER (WHERE tm.team_id IS NOT NULL), '[]') as memberships
       FROM users u
       LEFT JOIN team_memberships tm ON u.id = tm.user_id
       GROUP BY u.id, u.name, u.email, u.is_admin
       ORDER BY u.id ASC;`
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

app.get('/api/teams', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM teams ORDER BY name ASC;');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 5. Authenticated Work Items API routes (scoped via authMiddleware)
const apiRouter = express.Router();
apiRouter.use(authMiddleware);

// Keyset cursor pagination with server-side filters
apiRouter.get('/items', listItems);

// Individual work item retrieval
apiRouter.get('/items/:id', getItemById);

// Work item creation with Idempotency-Key
apiRouter.post('/items', requireIdempotency, createItem);

// Work item mutations
apiRouter.patch('/items/:id', updateItem);
apiRouter.post('/items/:id/claim', claimItem);
apiRouter.post('/items/:id/transition', transitionItem);
apiRouter.post('/items/:id/resolve', resolveItem);
apiRouter.post('/items/:id/comments', addComment);
apiRouter.delete('/items/:id', deleteItem);

// Transactional Outbox inspection & worker trigger
apiRouter.get('/outbox', async (req, res) => {
  const status = req.query.status as string;
  let querySql = 'SELECT * FROM outbox_events';
  const params: any[] = [];
  if (status) {
    querySql += ' WHERE status = $1';
    params.push(status);
  }
  querySql += ' ORDER BY created_at DESC LIMIT 50;';
  const { rows } = await pool.query(querySql, params);
  res.json(rows);
});

apiRouter.post('/outbox/process', async (_req, res) => {
  const result = await processOutboxBatch(10);
  res.json({ message: 'Outbox batch processed', ...result });
});

apiRouter.post('/outbox/simulate-failure', async (_req, res) => {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
     VALUES ($1, 'SIMULATED_FAILURE_TEST', $2, 'pending', 0, 3, NOW());`,
    [id, JSON.stringify({ reason: 'Simulated downstream failure test' })]
  );
  res.json({ message: 'Simulated failure event created', id });
});

app.use('/api', apiRouter);
