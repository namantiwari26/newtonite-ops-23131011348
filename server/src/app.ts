import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { authMiddleware } from './middleware/auth.js';
import { requireIdempotency } from './middleware/idempotency.js';
import { loginRateLimiter } from './middleware/rateLimiter.js';
import {
  listItems,
  getItemById,
  createItem,
  claimItem,
  updateItem,
  transitionItem,
  deleteItem,
  addComment,
} from './controllers/itemsController.js';
import { pool } from './db/pool.js';
import { processOutboxBatch } from './worker/outboxWorker.js';
import { login, getCurrentUser } from './controllers/authController.js';
import { AppError } from './errors.js';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'workdesk-api', timestamp: new Date().toISOString() });
});

// Authentication endpoints
app.post('/api/auth/login', loginRateLimiter, login);
app.get('/api/auth/me', authMiddleware, getCurrentUser);

// Metadata endpoints
app.get('/api/users', async (_req: Request, res: Response, next: NextFunction) => {
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
  } catch (err) {
    next(err);
  }
});

app.get('/api/teams', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query('SELECT * FROM teams ORDER BY name ASC;');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Authenticated Work Items API routes
const apiRouter = express.Router();
apiRouter.use(authMiddleware);

apiRouter.get('/items', listItems);
apiRouter.get('/items/:id', getItemById);
apiRouter.post('/items', requireIdempotency, createItem);
apiRouter.patch('/items/:id', updateItem);
apiRouter.post('/items/:id/claim', claimItem);
apiRouter.post('/items/:id/transition', transitionItem);
apiRouter.post('/items/:id/comments', addComment);
apiRouter.delete('/items/:id', deleteItem);

// Transactional Outbox inspection & worker trigger
apiRouter.get('/outbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/outbox/process', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await processOutboxBatch(10);
    res.json({ message: 'Outbox batch processed', ...result });
  } catch (err) {
    next(err);
  }
});

apiRouter.post(
  '/outbox/simulate-failure',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
       VALUES ($1, 'SIMULATED_FAILURE_TEST', $2, 'pending', 0, 3, NOW());`,
        [id, JSON.stringify({ reason: 'Simulated downstream failure test' })]
      );
      res.json({ message: 'Simulated failure event created', id });
    } catch (err) {
      next(err);
    }
  }
);

app.use('/api', apiRouter);

// Central error-handling middleware for uncaught errors
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details ? err.details : {}),
    });
    return;
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error('[Unhandled Server Error]:', err);
  }

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal server error occurred.',
  });
});
