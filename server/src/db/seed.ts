import bcrypt from 'bcrypt';
import { withTransaction } from './pool.js';
import { fileURLToPath } from 'url';

export async function seedData(): Promise<void> {
  const totalItems = parseInt(process.env.SEED_ITEMS || '20000', 10);
  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[Seed] Seeding Workdesk: 10 users across 3 teams and ${totalItems} work items (SEED_ITEMS=${totalItems})...`
    );
  }

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

    // 2. Insert 10 users
    // 1 Admin; per team 1 lead, 1 member, 1 viewer; 1 member in two teams (Marcus Chen)
    await client.query(
      `
      INSERT INTO users (id, name, email, password_hash, is_admin) VALUES
      ('usr_admin', 'Alex Vance', 'alex.vance@workdesk.test', $1, true),
      ('usr_priya', 'Priya Sharma', 'priya.sharma@workdesk.test', $1, false),
      ('usr_marcus', 'Marcus Chen', 'marcus.chen@workdesk.test', $1, false),
      ('usr_samira', 'Samira Khan', 'samira.khan@workdesk.test', $1, false),
      ('usr_elena', 'Elena Rostova', 'elena.rostova@workdesk.test', $1, false),
      ('usr_lucas', 'Lucas Silva', 'lucas.silva@workdesk.test', $1, false),
      ('usr_nina', 'Nina Patel', 'nina.patel@workdesk.test', $1, false),
      ('usr_rachel', 'Rachel Green', 'rachel.green@workdesk.test', $1, false),
      ('usr_sarah', 'Sarah Jenkins', 'sarah.jenkins@workdesk.test', $1, false),
      ('usr_david', 'David Morales', 'david.morales@workdesk.test', $1, false);
    `,
      [passwordHash]
    );

    // 3. Insert 3 standard teams
    await client.query(`
      INSERT INTO teams (id, name, description) VALUES
      ('team_billing', 'Billing & Payments', 'Customer billing, merchant payment gateways, invoices, and refunds'),
      ('team_platform', 'Core Platform', 'Cloud infrastructure, authentication, API gateway, and uptime'),
      ('team_support', 'Customer Operations', 'Customer support escalations, client onboardings, and requests');
    `);

    // 4. Insert Team Memberships
    // Billing: lead=Priya, member=Marcus, viewer=Samira
    // Platform: lead=Elena, member=Lucas & Marcus (Marcus is member in two teams), viewer=Nina
    // Support: lead=Rachel, member=Sarah, viewer=David
    await client.query(`
      INSERT INTO team_memberships (team_id, user_id, role) VALUES
      ('team_billing', 'usr_priya', 'lead'),
      ('team_billing', 'usr_marcus', 'member'),
      ('team_billing', 'usr_samira', 'viewer'),
      ('team_platform', 'usr_elena', 'lead'),
      ('team_platform', 'usr_lucas', 'member'),
      ('team_platform', 'usr_marcus', 'member'),
      ('team_platform', 'usr_nina', 'viewer'),
      ('team_support', 'usr_rachel', 'lead'),
      ('team_support', 'usr_sarah', 'member'),
      ('team_support', 'usr_david', 'viewer');
    `);

    // 5. Generate work items across the 3 teams (Task 4: SEED_ITEMS env var, default 20000)
    // Varied title selection using hash of ID across payment, support, and platform types
    // Varied priority, status, and about 20% assigned (80% unassigned)
    await client.query(
      `
      INSERT INTO work_items (
        id, team_id, title, description, type, status, priority,
        assignee_id, created_by, due_date, version, created_at, updated_at
      )
      SELECT
        'itm_' || LPAD(i::text, 6, '0'),
        (ARRAY['team_billing', 'team_platform', 'team_support'])[ (('x' || SUBSTRING(MD5((i * 3)::text), 1, 4))::bit(16)::int % 3) + 1 ],
        (ARRAY[
          -- Payment & Billing templates
          'Refund not processed for order #' || (10000 + (('x' || SUBSTRING(MD5((i * 13)::text), 1, 4))::bit(16)::int % 89999)),
          'Payment gateway timeout in merchant checkout flow',
          'Stripe webhook charge signature verification failed',
          'Invoice PDF reconciliation error for billing cycle',
          'Multi-currency settlement discrepancy in checkout',
          'Subscription upgrade proration calculation error',
          'Chargeback notification dispute pending review',
          'Declined credit card automatic retry threshold exceeded',
          'SEPA direct debit mandate authorization failure',
          -- Platform & Infrastructure templates
          'OAuth token refresh failure on Android mobile client',
          'Database connection pool exhausted in reporting cluster',
          'SSL certificate expiration alert on api gateway',
          'High latency detected in ingress proxy routing',
          'Redis session cache eviction rate spike',
          'Kafka consumer group lag alert in telemetry pipeline',
          'Rate limit exceeded on public REST API endpoint',
          'Single Sign-On SAML assertion parsing exception',
          'Elasticsearch cluster index red status alert',
          -- Support & Customer Operations templates
          'Customer notification email bounce in transactional pipeline',
          'Cart recalculation discrepancy in enterprise workspace',
          'Audit log synchronization delay for customer account',
          'User invitation link expired before tenant activation',
          'Two-factor authentication emergency reset request',
          'Password reset email delivery delay for customer',
          'Bulk export to CSV memory limit exceeded',
          'Team member seat allocation limit reached in organization',
          'Customer onboarding flow stalled at verification step'
        ])[ (('x' || SUBSTRING(MD5(i::text), 1, 4))::bit(16)::int % 27) + 1 ],
        'Detailed diagnostic report and support context for ticket ' || i || '. Customer transaction logs and telemetry metrics attached for investigation.',
        (ARRAY['task', 'bug', 'feature', 'incident'])[ (('x' || SUBSTRING(MD5((i * 17)::text), 1, 4))::bit(16)::int % 4) + 1 ],
        (ARRAY['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'])[ (('x' || SUBSTRING(MD5((i * 11)::text), 1, 4))::bit(16)::int % 5) + 1 ],
        (ARRAY['low', 'medium', 'high', 'critical'])[ (('x' || SUBSTRING(MD5((i * 7)::text), 1, 4))::bit(16)::int % 4) + 1 ],
        -- About 20% assigned, 80% unassigned
        CASE WHEN (('x' || SUBSTRING(MD5((i * 23)::text), 1, 4))::bit(16)::int % 100 < 20)
          THEN (ARRAY['usr_marcus', 'usr_sarah', 'usr_lucas', 'usr_priya', 'usr_elena', 'usr_rachel'])[ (('x' || SUBSTRING(MD5((i * 31)::text), 1, 4))::bit(16)::int % 6) + 1 ]
          ELSE NULL
        END,
        (ARRAY['usr_admin', 'usr_priya', 'usr_elena', 'usr_rachel', 'usr_marcus', 'usr_sarah'])[ (('x' || SUBSTRING(MD5((i * 29)::text), 1, 4))::bit(16)::int % 6) + 1 ],
        NOW() + ((((('x' || SUBSTRING(MD5((i * 37)::text), 1, 4))::bit(16)::int % 40) - 10)) || ' days')::interval,
        1 + (('x' || SUBSTRING(MD5((i * 41)::text), 1, 4))::bit(16)::int % 3),
        NOW() - ((('x' || SUBSTRING(MD5((i * 43)::text), 1, 4))::bit(16)::int % 60) || ' days')::interval - ((i % 24) || ' hours')::interval,
        NOW() - ((('x' || SUBSTRING(MD5((i * 47)::text), 1, 4))::bit(16)::int % 10) || ' days')::interval
      FROM generate_series(1, $1::int) AS i;
    `,
      [totalItems]
    );

    // 6. Generate corresponding activity events for the seeded items
    await client.query(
      `
      INSERT INTO activity_events (id, item_id, actor_id, action, details, created_at)
      SELECT
        'act_' || LPAD(i::text, 6, '0') || '_init',
        'itm_' || LPAD(i::text, 6, '0'),
        (ARRAY['usr_admin', 'usr_priya', 'usr_elena', 'usr_rachel', 'usr_marcus', 'usr_sarah'])[(i % 6) + 1],
        'created',
        json_build_object('item_id', 'itm_' || LPAD(i::text, 6, '0'), 'source', 'initial_seed')::jsonb,
        NOW() - ((i % 60) || ' days')::interval
      FROM generate_series(1, $1::int) AS i;
    `,
      [totalItems]
    );

    // 7. Insert starter comments on first items
    await client.query(`
      INSERT INTO comments (id, item_id, user_id, content) VALUES
      ('cmt_001', 'itm_000001', 'usr_priya', 'Customer support ticket has been linked. Refund request submitted to finance.'),
      ('cmt_002', 'itm_000002', 'usr_marcus', 'Adjusted timeout to 4500ms on the staging cluster. Monitoring gateway metrics.'),
      ('cmt_003', 'itm_000004', 'usr_elena', 'Waiting for platform team lead to sign off on token rotation schema.');
    `);

    if (process.env.NODE_ENV !== 'test') {
      console.log(
        `[Seed] Seeding complete: 10 users, 3 teams, ${totalItems} work items, and ${totalItems} activity events created.`
      );
    }
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
