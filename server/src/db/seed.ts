import bcrypt from 'bcrypt';
import { withTransaction } from './pool.js';
import { fileURLToPath } from 'url';

export async function seedData(): Promise<void> {
  console.log('[Seed] Seeding Workdesk users, teams, and 5,000 work items via SQL generate_series...');

  // Hash shared demo password: Demo@12345
  const passwordHash = await bcrypt.hash('Demo@12345', 10);

  await withTransaction(async (client) => {
    // 1. Clear existing data in reverse dependency order
    await client.query('DELETE FROM comments;');
    await client.query('DELETE FROM outbox_events;');
    await client.query('DELETE FROM activity_events;');
    await client.query('DELETE FROM idempotency_keys;');
    await client.query('DELETE FROM work_items;');
    await client.query('DELETE FROM team_memberships;');
    await client.query('DELETE FROM teams;');
    await client.query('DELETE FROM users;');

    // 2. Insert 5 realistic enterprise users (Task 1 & Task 2)
    // Priya is admin; Marcus, Sarah, Elena, David are regular users
    await client.query(`
      INSERT INTO users (id, name, email, password_hash, is_admin) VALUES
      ('usr_priya', 'Priya Sharma', 'priya.sharma@workdesk.test', $1, true),
      ('usr_marcus', 'Marcus Chen', 'marcus.chen@workdesk.test', $1, false),
      ('usr_sarah', 'Sarah Jenkins', 'sarah.jenkins@workdesk.test', $1, false),
      ('usr_elena', 'Elena Rostova', 'elena.rostova@workdesk.test', $1, false),
      ('usr_david', 'David Morales', 'david.morales@workdesk.test', $1, false);
    `, [passwordHash]);

    // 3. Insert 3 standard teams
    await client.query(`
      INSERT INTO teams (id, name, description) VALUES
      ('team_billing', 'Billing & Payments', 'Customer billing, merchant payment gateways, invoices, and refunds'),
      ('team_platform', 'Core Platform', 'Cloud infrastructure, authentication, API gateway, and uptime'),
      ('team_support', 'Customer Operations', 'Customer support escalations, client onboardings, and requests');
    `);

    // 4. Insert Team Memberships (roles: viewer, member, lead)
    await client.query(`
      INSERT INTO team_memberships (team_id, user_id, role) VALUES
      ('team_billing', 'usr_priya', 'lead'),
      ('team_billing', 'usr_marcus', 'lead'),
      ('team_billing', 'usr_sarah', 'member'),
      ('team_platform', 'usr_priya', 'lead'),
      ('team_platform', 'usr_marcus', 'member'),
      ('team_platform', 'usr_elena', 'lead'),
      ('team_support', 'usr_priya', 'lead'),
      ('team_support', 'usr_sarah', 'member'),
      ('team_support', 'usr_david', 'viewer');
    `);

    // 5. Generate 5,000 realistic work items across the 3 teams (Task 5)
    // ~20% unassigned (i % 5 = 0), varied status, priority, type, due dates, created dates
    await client.query(`
      INSERT INTO work_items (
        id, team_id, title, description, type, status, priority,
        assignee_id, created_by, due_date, version, created_at, updated_at
      )
      SELECT
        'itm_' || LPAD(i::text, 5, '0'),
        (ARRAY['team_billing', 'team_platform', 'team_support'])[(i % 3) + 1],
        (ARRAY[
          'Refund not processed for',
          'Payment gateway timeout in',
          'OAuth token refresh failure on',
          'High latency in checkout',
          'Invoice PDF generation error for',
          'Database connection pool exhausted in',
          'SSL certificate expiration alert for',
          'Webhook delivery failure for',
          'Bulk export to CSV memory limit in',
          'Single Sign-On SAML configuration for',
          'Subscription upgrade charge failure for',
          'Rate limit exceeded on public API for',
          'Customer notification email bounce in',
          'Cart recalculation discrepancy in',
          'Audit log synchronization delay in'
        ])[(i % 15) + 1] || ' ' ||
        (ARRAY[
          'order #' || (10000 + (i * 7 % 89999)),
          'merchant checkout flow',
          'Android mobile client',
          'Stripe charge ch_' || SUBSTRING(MD5(i::text), 1, 8),
          'enterprise workspace #' || (200 + (i % 800)),
          'reporting cluster node ' || (1 + (i % 8)),
          'api gateway edge proxy',
          'partner webhook subscription',
          'background export job #' || (4000 + i),
          'Okta directory sync service',
          'annual billing cycle',
          'v2 telemetry endpoints',
          'transactional email pipeline',
          'multi-currency checkout session',
          'SOC2 compliance audit logs'
        ])[(i % 15) + 1],
        'Detailed diagnostic report and support context for ticket ' || i || '. Customer transaction logs and telemetry metrics attached for investigation.',
        (ARRAY['task', 'bug', 'feature', 'incident'])[(i % 4) + 1],
        (ARRAY['open', 'in_progress', 'blocked', 'resolved', 'closed'])[(i % 5) + 1],
        (ARRAY['low', 'medium', 'high', 'critical'])[(i % 4) + 1],
        CASE WHEN (i % 5 = 0) THEN NULL ELSE (ARRAY['usr_marcus', 'usr_sarah', 'usr_elena', 'usr_priya'])[(i % 4) + 1] END,
        (ARRAY['usr_priya', 'usr_marcus', 'usr_sarah', 'usr_elena'])[(i % 4) + 1],
        NOW() + (((i % 40) - 10) || ' days')::interval,
        1 + (i % 3),
        NOW() - ((i % 60) || ' days')::interval - ((i % 24) || ' hours')::interval,
        NOW() - ((i % 10) || ' days')::interval
      FROM generate_series(1, 5000) AS i;
    `);

    // 6. Generate corresponding activity events for the 5,000 items
    await client.query(`
      INSERT INTO activity_events (id, item_id, actor_id, action, details, created_at)
      SELECT
        'act_' || LPAD(i::text, 5, '0') || '_init',
        'itm_' || LPAD(i::text, 5, '0'),
        (ARRAY['usr_priya', 'usr_marcus', 'usr_sarah', 'usr_elena'])[(i % 4) + 1],
        'created',
        json_build_object('item_id', 'itm_' || LPAD(i::text, 5, '0'), 'source', 'initial_seed')::jsonb,
        NOW() - ((i % 60) || ' days')::interval
      FROM generate_series(1, 5000) AS i;
    `);

    // 7. Insert starter comments on first items
    await client.query(`
      INSERT INTO comments (id, item_id, user_id, content) VALUES
      ('cmt_001', 'itm_00001', 'usr_priya', 'Customer support ticket has been linked. Refund request submitted to finance.'),
      ('cmt_002', 'itm_00002', 'usr_marcus', 'Adjusted timeout to 4500ms on the staging cluster. Monitoring gateway metrics.'),
      ('cmt_003', 'itm_00004', 'usr_elena', 'Waiting for mobile team lead to sign off on token rotation schema.');
    `);

    console.log('[Seed] Seeding complete: 5 users, 3 teams, 5,000 work items, and 5,000 activity events created.');
  });
}

// Allow direct execution: `tsx src/db/seed.ts`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed Error]:', err);
      process.exit(1);
    });
}
