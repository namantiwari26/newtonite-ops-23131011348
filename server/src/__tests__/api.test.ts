import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { seedData } from '../db/seed.js';
import { processOutboxBatch } from '../worker/outboxWorker.js';
import { getJwtSecret } from '../controllers/authController.js';

describe('Workdesk - Work Items API & Core Rules Integration Tests', () => {
  let adminToken: string;
  let marcusToken: string;
  let davidToken: string;

  beforeAll(async () => {
    // Ensure JWT_SECRET is set for tests
    process.env.JWT_SECRET = 'test_jwt_secret_key_minimum_32_characters';
    await runMigrations();
    await seedData();

    adminToken = jwt.sign({ sub: 'usr_priya' }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '8h' });
    marcusToken = jwt.sign({ sub: 'usr_marcus' }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '8h' });
    davidToken = jwt.sign({ sub: 'usr_david' }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '8h' });
  });

  afterAll(async () => {
    await pool.end();
  });

  // Task 1: Authentication Tests
  describe('Task 1: Authentication & JWT (HS256, sub-only, 8h)', () => {
    it('successfully logs in an existing user with Demo@12345 and returns HS256 sub JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'priya.sharma@workdesk.test',
          password: 'Demo@12345',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      // Verify token contains only sub and algorithm is HS256
      const decoded: any = jwt.verify(res.body.token, getJwtSecret(), { algorithms: ['HS256'] });
      expect(decoded.sub).toBe('usr_priya');

      expect(res.body.user.name).toBe('Priya Sharma');
      expect(res.body.user.is_admin).toBe(true);
      expect(res.body.user.role).toBeUndefined(); // Role column removed from users
      expect(res.body.user.memberships.length).toBeGreaterThan(0);
    });

    it('rejects login with 401 and generic message when wrong password is provided', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'priya.sharma@workdesk.test',
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects login with 401 when email does not exist', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@workdesk.test',
          password: 'Demo@12345',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects requests with fake token with 401', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('Authorization', 'Bearer fake.invalid.token');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('accepts requests with valid JWT token (200)', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });
  });

  // Task 2: Authorization & Team Scoping
  describe('Task 2: Team-scoped Authorization & 404 for outside team', () => {
    it('returns 404 when user is outside an item team', async () => {
      // itm_00001 belongs to team_billing. usr_david only belongs to team_support (viewer)
      const res = await request(app)
        .get('/api/items/itm_00001')
        .set('Authorization', `Bearer ${davidToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('allows team member to view an item in their team', async () => {
      // itm_00001 belongs to team_billing. usr_marcus is lead on team_billing
      const res = await request(app)
        .get('/api/items/itm_00001')
        .set('Authorization', `Bearer ${marcusToken}`);

      expect(res.status).toBe(200);
      expect(res.body.item.id).toBe('itm_00001');
    });

    it('denies viewers from mutating items (403)', async () => {
      // itm_00002 belongs to team_support where usr_david is viewer
      const res = await request(app)
        .patch('/api/items/itm_00002')
        .set('Authorization', `Bearer ${davidToken}`)
        .send({ title: 'Viewer attempting mutation', expected_version: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });

  // Idempotency & Creation
  describe('Idempotency-Key Enforcement', () => {
    it('returns 400 Bad Request if Idempotency-Key header is missing', async () => {
      const res = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          team_id: 'team_billing',
          title: 'Invoice recalculation for customer #9012',
          priority: 'high',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('creates item on first request and returns cached response on identical key replay', async () => {
      const idempotencyKey = `key_test_${Date.now()}`;

      const res1 = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          team_id: 'team_billing',
          title: 'Investigate payment retry backlog',
          description: 'Payment retry queue delayed by 15 minutes',
          priority: 'critical',
        });

      expect(res1.status).toBe(201);
      expect(res1.body.item).toBeDefined();
      expect(res1.headers['x-cache-lookup']).toBeUndefined();

      const createdItemId = res1.body.item.id;

      const res2 = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          team_id: 'team_billing',
          title: 'Investigate payment retry backlog',
          description: 'Payment retry queue delayed by 15 minutes',
          priority: 'critical',
        });

      expect(res2.status).toBe(201);
      expect(res2.headers['x-cache-lookup']).toBe('HIT');
      expect(res2.body.item.id).toBe(createdItemId);
    });
  });

  // Atomic Item Change and Activity Event
  describe('Atomic Item Change and Activity Event Transaction', () => {
    it('writes activity_event and outbox_event in the same transaction as item creation', async () => {
      const idempotencyKey = `key_tx_test_${Date.now()}`;
      const res = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          team_id: 'team_billing',
          title: 'Stripe webhook endpoint latency alert',
          priority: 'high',
        });

      expect(res.status).toBe(201);
      const itemId = res.body.item.id;

      const eventsRes = await pool.query(
        'SELECT * FROM activity_events WHERE item_id = $1',
        [itemId]
      );
      expect(eventsRes.rows.length).toBeGreaterThan(0);
      expect(eventsRes.rows[0].action).toBe('created');
      expect(eventsRes.rows[0].actor_id).toBe('usr_priya');

      const outboxRes = await pool.query(
        "SELECT * FROM outbox_events WHERE payload->>'item_id' = $1",
        [itemId]
      );
      expect(outboxRes.rows.length).toBeGreaterThan(0);
      expect(outboxRes.rows[0].event_type).toBe('ITEM_CREATED_NOTIFICATION');
    });
  });

  // Claim Semantics
  describe('Claim Semantics (UPDATE ... WHERE assignee_id IS NULL)', () => {
    it('successfully claims an unclaimed item with matching version', async () => {
      // itm_00015 has i % 5 = 0 (unassigned) and belongs to team_billing where marcus is lead
      const res = await request(app)
        .post('/api/items/itm_00015/claim')
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({ expected_version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.item.assignee_id).toBe('usr_marcus');
      expect(res.body.item.status).toBe('in_progress');
      expect(res.body.item.version).toBe(2);

      const actRes = await pool.query(
        "SELECT * FROM activity_events WHERE item_id = 'itm_00015' AND action = 'claimed'"
      );
      expect(actRes.rowCount).toBe(1);
    });

    it('returns 409 ALREADY_CLAIMED when attempting to claim an already assigned item', async () => {
      // itm_00015 is now claimed
      const res = await request(app)
        .post('/api/items/itm_00015/claim')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 2 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ALREADY_CLAIMED');
    });
  });

  // Optimistic Locking
  describe('Optimistic Locking with version column', () => {
    it('rejects update with 409 OPTIMISTIC_LOCK_CONFLICT when expected_version is stale', async () => {
      // itm_00001 belongs to team_platform where marcus is a member
      const res = await request(app)
        .patch('/api/items/itm_00001')
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({
          title: 'Attempting Stale Overwrite',
          expected_version: 999, // Stale version
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('OPTIMISTIC_LOCK_CONFLICT');
    });

    it('succeeds update when expected_version matches, incrementing version', async () => {
      const itemRes = await pool.query('SELECT version FROM work_items WHERE id = $1', ['itm_00001']);
      const currentVersion = itemRes.rows[0].version;

      const res = await request(app)
        .patch('/api/items/itm_00001')
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({
          title: 'Payment gateway timeout in checkout (Investigating)',
          priority: 'medium',
          expected_version: currentVersion,
        });

      expect(res.status).toBe(200);
      expect(res.body.item.version).toBe(currentVersion + 1);
    });
  });

  // Comments
  describe('Comments on Work Items', () => {
    it('adds a comment to a work item', async () => {
      const res = await request(app)
        .post('/api/items/itm_00001/comments')
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({ content: 'Verified with finance team; payment cleared.' });

      expect(res.status).toBe(201);
      expect(res.body.comment.content).toBe('Verified with finance team; payment cleared.');
    });
  });

  // Server-side cursor pagination
  describe('Server-side Filters and Cursor Pagination on 5000 items', () => {
    it('paginates 5,000 items using cursor and limit without loading everything', async () => {
      const page1 = await request(app)
        .get('/api/items?team_id=team_billing&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(10);
      expect(page1.body.has_more).toBe(true);
      expect(page1.body.next_cursor).toBeDefined();
      expect(page1.body.total_count).toBeGreaterThan(1000);

      const page2 = await request(app)
        .get(`/api/items?team_id=team_billing&limit=10&cursor=${encodeURIComponent(page1.body.next_cursor)}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBe(10);
      expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    });

    it('filters items by status and priority on server-side', async () => {
      const res = await request(app)
        .get('/api/items?priority=critical')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.items.forEach((item: any) => {
        expect(item.priority).toBe('critical');
      });
    });
  });

  // Transactional Outbox
  describe('Transactional Outbox Worker & Retries', () => {
    it('processes pending outbox events successfully', async () => {
      const batchResult = await processOutboxBatch(10);
      expect(batchResult.processed).toBeGreaterThan(0);
      expect(batchResult.succeeded).toBeGreaterThan(0);
    });

    it('retries failed events with backoff and marks failed when max_attempts reached', async () => {
      const failEventId = `out_test_fail_${Date.now()}`;

      await pool.query(
        `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
         VALUES ($1, 'SIMULATED_FAILURE_TEST', '{}'::jsonb, 'pending', 0, 2, NOW());`,
        [failEventId]
      );

      const run1 = await processOutboxBatch(10);
      expect(run1.failed).toBeGreaterThanOrEqual(1);

      await pool.query(
        'UPDATE outbox_events SET next_run_at = NOW() WHERE id = $1',
        [failEventId]
      );

      const run2 = await processOutboxBatch(10);
      expect(run2.failed).toBeGreaterThanOrEqual(1);

      const afterRun2 = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [failEventId]
      );
      expect(afterRun2.rows[0].attempts).toBe(2);
      expect(afterRun2.rows[0].status).toBe('failed');
    });
  });
});
