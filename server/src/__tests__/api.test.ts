import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { processOutboxBatch } from '../worker/outboxWorker.js';
import { getJwtSecret } from '../controllers/authController.js';
import { WorkItem } from '../types.js';

describe('Workdesk - Work Items API & Workflow Integration Tests', () => {
  let adminToken: string;
  let priyaToken: string;
  let marcusToken: string;
  let samiraToken: string;
  let rachelToken: string;
  let davidToken: string;

  beforeAll(() => {
    // Generate valid HS256 tokens (sub only) for test personas
    const secret = getJwtSecret();
    adminToken = jwt.sign({ sub: 'usr_admin' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
    priyaToken = jwt.sign({ sub: 'usr_priya' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
    marcusToken = jwt.sign({ sub: 'usr_marcus' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
    samiraToken = jwt.sign({ sub: 'usr_samira' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
    rachelToken = jwt.sign({ sub: 'usr_rachel' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
    davidToken = jwt.sign({ sub: 'usr_david' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
  });

  // 1. Authentication Tests
  describe('Authentication & JWT (HS256, sub-only, 8h)', () => {
    it('successfully logs in an existing user with Demo@12345 and returns HS256 sub JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'alex.vance@workdesk.test',
          password: 'Demo@12345',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const decoded: any = jwt.verify(res.body.token, getJwtSecret(), { algorithms: ['HS256'] });
      expect(decoded.sub).toBe('usr_admin');
      expect(res.body.user.name).toBe('Alex Vance');
      expect(res.body.user.is_admin).toBe(true);
      expect(res.body.user.role).toBeUndefined(); // Global role removed
    });

    it('rejects login with 401 and generic message when wrong password is provided', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'alex.vance@workdesk.test',
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_CREDENTIALS');
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
      expect(res.body.error).toBe('INVALID_CREDENTIALS');
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects requests with fake token with 401', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('Authorization', 'Bearer fake_invalid_token_99999');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('accepts requests with valid JWT token (200)', async () => {
      const res = await request(app)
        .get('/api/items?limit=5')
        .set('Authorization', `Bearer ${priyaToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total_count).toBeGreaterThan(0);
    });
  });

  // 2. Specific Workflow, Authorization, and Concurrency Tests (Tasks 2 & 6)
  describe('Workflow & Status Transitions', () => {
    it('(a) Open→Closed returns 409', async () => {
      // Find an open item in team_billing
      const itemRes = await pool.query<WorkItem>(
        "SELECT * FROM work_items WHERE team_id = 'team_billing' AND status = 'open' LIMIT 1"
      );
      const item = itemRes.rows[0];

      const res = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`) // Priya is Lead of Billing
        .send({ to: 'closed', version: item.version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_TRANSITION');
    });

    it('(b) a member cannot approve (403)', async () => {
      // Place an item in team_billing into awaiting_approval state
      const itemRes = await pool.query<WorkItem>(
        "SELECT * FROM work_items WHERE team_id = 'team_billing' LIMIT 1"
      );
      const item = itemRes.rows[0];

      await pool.query(
        "UPDATE work_items SET status = 'awaiting_approval' WHERE id = $1",
        [item.id]
      );
      const fresh = (await pool.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [item.id])).rows[0];

      // Marcus Chen is a member (not lead) of team_billing
      const res = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({ to: 'resolved', version: fresh.version });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('(c) a lead of another team gets 404', async () => {
      // Item belongs to team_billing
      const itemRes = await pool.query<WorkItem>(
        "SELECT * FROM work_items WHERE team_id = 'team_billing' LIMIT 1"
      );
      const item = itemRes.rows[0];

      // Rachel Green is Lead of team_support (has NO membership in team_billing)
      const res = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${rachelToken}`)
        .send({ to: 'in_progress', version: item.version });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('(d) a stale version returns 409 and data is unchanged', async () => {
      const itemRes = await pool.query<WorkItem>(
        "SELECT * FROM work_items WHERE team_id = 'team_billing' AND status = 'open' LIMIT 1"
      );
      const originalItem = itemRes.rows[0];

      const res = await request(app)
        .post(`/api/items/${originalItem.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`)
        .send({ to: 'in_progress', version: 99999 }); // Stale version

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('OPTIMISTIC_LOCK_CONFLICT');
      expect(res.body.item).toBeDefined();

      // Verify that database record was not modified
      const checkRes = await pool.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [originalItem.id]);
      const currentItem = checkRes.rows[0];
      expect(currentItem.status).toBe(originalItem.status);
      expect(currentItem.version).toBe(originalItem.version);
      expect(currentItem.title).toBe(originalItem.title);
    });

    it('(e) two parallel claims, exactly one succeeds', async () => {
      // Create a fresh unassigned item in team_billing
      const createRes = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          team_id: 'team_billing',
          title: 'Parallel Claim Race Condition Test Item',
          priority: 'high',
        });

      const testItem = createRes.body.item;
      expect(testItem.assignee_id).toBeNull();

      // Concurrently attempt to claim the item with Priya and Marcus
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/items/${testItem.id}/claim`)
          .set('Authorization', `Bearer ${priyaToken}`)
          .send({ expected_version: testItem.version }),
        request(app)
          .post(`/api/items/${testItem.id}/claim`)
          .set('Authorization', `Bearer ${marcusToken}`)
          .send({ expected_version: testItem.version }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const successRes = res1.status === 200 ? res1 : res2;
      const conflictRes = res1.status === 409 ? res1 : res2;

      expect(successRes.body.item.assignee_id).not.toBeNull();
      expect(['ALREADY_CLAIMED', 'OPTIMISTIC_LOCK_CONFLICT']).toContain(conflictRes.body.error);
    });

    it('(f) the same Idempotency-Key sent twice creates one item', async () => {
      const idempotencyKey = crypto.randomUUID();
      const payload = {
        team_id: 'team_billing',
        title: 'Idempotent Creation Test Item',
        description: 'Verify identical payload and cached replay',
        priority: 'medium',
      };

      const res1 = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const createdItemId = res1.body.item.id;

      const res2 = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.item.id).toBe(createdItemId);

      // Verify DB contains exactly 1 row
      const countRes = await pool.query<{ count: string }>(
        'SELECT count(*) as count FROM work_items WHERE id = $1',
        [createdItemId]
      );
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
    });

    it('returns 422 when the same Idempotency-Key is sent with a different body', async () => {
      const idempotencyKey = crypto.randomUUID();

      const res1 = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          team_id: 'team_billing',
          title: 'Initial Request Body Payload',
          priority: 'high',
        });

      expect(res1.status).toBe(201);
      expect(res1.body.item.title).toBe('Initial Request Body Payload');

      const res2 = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          team_id: 'team_billing',
          title: 'Different Request Body Payload',
          priority: 'low',
        });

      expect(res2.status).toBe(422);
      expect(res2.body.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('two concurrent requests with the same key create only one item', async () => {
      const idempotencyKey = crypto.randomUUID();
      const payload = {
        team_id: 'team_billing',
        title: 'Concurrent Idempotent Creation Item',
        priority: 'high',
      };

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/items')
          .set('Authorization', `Bearer ${priyaToken}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
        request(app)
          .post('/api/items')
          .set('Authorization', `Bearer ${priyaToken}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.item.id).toBe(res2.body.item.id);

      const dbCheck = await pool.query(
        "SELECT COUNT(*) FROM work_items WHERE title = 'Concurrent Idempotent Creation Item'"
      );
      expect(parseInt(dbCheck.rows[0].count, 10)).toBe(1);
    });

    it('(g) an outbox job processed twice creates one notification', async () => {
      const outboxId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
         VALUES ($1, 'ITEM_CREATED_NOTIFICATION', $2, 'pending', 0, 3, NOW());`,
        [
          outboxId,
          JSON.stringify({
            item_id: 'itm_dedup_001',
            team_id: 'team_billing',
            title: 'Outbox deduplication test',
          }),
        ]
      );

      // Pass 1: processes the event and marks it completed
      const batch1 = await processOutboxBatch(10);
      expect(batch1.processed).toBeGreaterThanOrEqual(1);

      const check1 = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [outboxId]
      );
      expect(check1.rows[0].status).toBe('completed');
      expect(check1.rows[0].attempts).toBe(1);

      // Pass 2: processes outbox again
      await processOutboxBatch(10);

      // The completed event was NOT processed a second time (attempts remains 1)
      const check2 = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [outboxId]
      );
      expect(check2.rows[0].status).toBe('completed');
      expect(check2.rows[0].attempts).toBe(1);
    });
  });

  // 3. Allowed Workflow Progression
  describe('Enforced Allowed Transitions Lifecycle', () => {
    it('executes full transition lifecycle: open -> in_progress -> awaiting_approval -> resolved -> closed', async () => {
      // 1. Create open item
      const createRes = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          team_id: 'team_billing',
          title: 'Full Workflow Lifecycle Item',
          priority: 'high',
        });
      expect(createRes.status).toBe(201);
      let item = createRes.body.item;
      expect(item.status).toBe('open');

      // 2. Member transitions open -> in_progress
      const step1 = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({ to: 'in_progress', version: item.version });
      expect(step1.status).toBe(200);
      item = step1.body.item;
      expect(item.status).toBe('in_progress');

      // 3. Member transitions in_progress -> awaiting_approval
      const step2 = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({ to: 'awaiting_approval', version: item.version });
      expect(step2.status).toBe(200);
      item = step2.body.item;
      expect(item.status).toBe('awaiting_approval');

      // 4. Lead approves: awaiting_approval -> resolved
      const step3 = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`)
        .send({ to: 'resolved', version: item.version });
      expect(step3.status).toBe(200);
      item = step3.body.item;
      expect(item.status).toBe('resolved');

      // 5. Lead closes: resolved -> closed
      const step4 = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`)
        .send({ to: 'closed', version: item.version });
      expect(step4.status).toBe(200);
      item = step4.body.item;
      expect(item.status).toBe('closed');
    });

    it('allows lead to reject awaiting_approval back to in_progress', async () => {
      const createRes = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          team_id: 'team_billing',
          title: 'Rejection Lifecycle Item',
          priority: 'medium',
        });
      let item = createRes.body.item;

      // Move to awaiting_approval
      await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`)
        .send({ to: 'in_progress', version: item.version });

      item = (await pool.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [item.id])).rows[0];

      await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`)
        .send({ to: 'awaiting_approval', version: item.version });

      item = (await pool.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [item.id])).rows[0];
      expect(item.status).toBe('awaiting_approval');

      // Lead rejects: awaiting_approval -> in_progress
      const rejectRes = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${priyaToken}`)
        .send({ to: 'in_progress', version: item.version });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.item.status).toBe('in_progress');
    });

    it('denies viewers from transitioning items (403)', async () => {
      // itm belongs to team_billing where samira is viewer
      const itemRes = await pool.query<WorkItem>(
        "SELECT * FROM work_items WHERE team_id = 'team_billing' AND status = 'open' LIMIT 1"
      );
      const item = itemRes.rows[0];

      const res = await request(app)
        .post(`/api/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${samiraToken}`)
        .send({ to: 'in_progress', version: item.version });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });

  // 4. Keyset Cursor Pagination & Filters
  describe('Server-side Filters and Keyset Pagination', () => {
    it('paginates items using cursor and limit without loading everything', async () => {
      const page1 = await request(app)
        .get('/api/items?limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(5);
      expect(page1.body.has_more).toBe(true);
      expect(page1.body.next_cursor).toBeDefined();

      const page2 = await request(app)
        .get(`/api/items?limit=5&cursor=${encodeURIComponent(page1.body.next_cursor)}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBe(5);
      expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    });

    it('filters items by team_id and status server-side', async () => {
      const res = await request(app)
        .get('/api/items?team_id=team_billing&status=open&limit=10')
        .set('Authorization', `Bearer ${priyaToken}`);

      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item.team_id).toBe('team_billing');
        expect(item.status).toBe('open');
      }
    });
  });

  // 5. Comments
  describe('Comments on Work Items', () => {
    it('allows team members to add comments', async () => {
      const itemRes = await pool.query<WorkItem>(
        "SELECT * FROM work_items WHERE team_id = 'team_billing' LIMIT 1"
      );
      const item = itemRes.rows[0];

      const res = await request(app)
        .post(`/api/items/${item.id}/comments`)
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({ content: 'Investigation notes added by team member' });

      expect(res.status).toBe(201);
      expect(res.body.comment.content).toBe('Investigation notes added by team member');
    });
  });

  // 6. Transactional Outbox Worker & Retries
  describe('Transactional Outbox Worker & Retries', () => {
    it('processes pending events successfully', async () => {
      const eventId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
         VALUES ($1, 'ITEM_CREATED_NOTIFICATION', '{"team_id":"team_billing","title":"Outbox test"}'::jsonb, 'pending', 0, 3, NOW());`,
        [eventId]
      );

      const batchResult = await processOutboxBatch(10);
      expect(batchResult.processed).toBeGreaterThan(0);
      expect(batchResult.succeeded).toBeGreaterThan(0);

      const check = await pool.query('SELECT status FROM outbox_events WHERE id = $1', [eventId]);
      expect(check.rows[0].status).toBe('completed');
    });

    it('retries with backoff and marks failed at max attempts', async () => {
      const failEventId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
         VALUES ($1, 'SIMULATED_FAILURE_TEST', '{}'::jsonb, 'pending', 0, 2, NOW());`,
        [failEventId]
      );

      // Attempt 1: fails, increments attempts to 1, schedules backoff
      const run1 = await processOutboxBatch(10);
      expect(run1.failed).toBeGreaterThanOrEqual(1);

      // Fast-forward next_run_at to simulate backoff elapsing
      await pool.query(
        'UPDATE outbox_events SET next_run_at = NOW() WHERE id = $1',
        [failEventId]
      );

      // Attempt 2: fails, reaches max_attempts (2), marks status = 'failed'
      const run2 = await processOutboxBatch(10);
      expect(run2.failed).toBeGreaterThanOrEqual(1);

      const afterRun2 = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [failEventId]
      );
      expect(afterRun2.rows[0].attempts).toBe(2);
      expect(afterRun2.rows[0].status).toBe('failed');
    });

    it('reclaims stale processing jobs stuck for >60s and retries until completion', async () => {
      const staleEventId = crypto.randomUUID();

      // Insert an outbox event stuck in 'processing' with locked_at 70 seconds ago
      await pool.query(
        `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at, locked_at)
         VALUES ($1, 'ITEM_CREATED_NOTIFICATION', '{"team_id":"team_billing","title":"Stale recovered job"}'::jsonb, 'processing', 0, 2, NOW(), NOW() - INTERVAL '70 seconds');`,
        [staleEventId]
      );

      // Run batch: should reclaim stale job, increment attempts to 1, reset locked_at, and schedule backoff retry
      const run1 = await processOutboxBatch(10);
      expect(run1.reclaimed).toBeGreaterThanOrEqual(1);

      const afterReclaim = await pool.query(
        'SELECT status, attempts, locked_at FROM outbox_events WHERE id = $1',
        [staleEventId]
      );
      expect(afterReclaim.rows[0].status).toBe('pending');
      expect(afterReclaim.rows[0].attempts).toBe(1);
      expect(afterReclaim.rows[0].locked_at).toBeNull();

      // Fast-forward next_run_at to simulate backoff duration elapsing
      await pool.query('UPDATE outbox_events SET next_run_at = NOW() WHERE id = $1', [staleEventId]);

      // Run batch again: job is now pending and due, so it executes and completes!
      const run2 = await processOutboxBatch(10);
      expect(run2.succeeded).toBeGreaterThanOrEqual(1);

      const completed = await pool.query(
        'SELECT status, attempts, locked_at FROM outbox_events WHERE id = $1',
        [staleEventId]
      );
      expect(completed.rows[0].status).toBe('completed');
      expect(completed.rows[0].attempts).toBe(2);
      expect(completed.rows[0].locked_at).toBeNull();
    });
  });
});
