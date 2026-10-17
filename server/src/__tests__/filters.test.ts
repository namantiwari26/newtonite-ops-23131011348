import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import { getJwtSecret } from '../controllers/authController.js';
import { pool } from '../db/pool.js';
import {
  DEFAULT_FILTERS,
  getViewFilters,
  VIEW_TITLES,
  detectActiveView,
  buildFilterQueryParams,
  buildQueryString,
  getFilterChips,
  FilterState,
} from '../../../client/src/filterUtils.js';

describe('Sidebar Views, Filter Toolbar & Single Source of Truth Parity', () => {
  let adminToken: string;
  let priyaToken: string;

  beforeAll(async () => {
    const secret = getJwtSecret();
    adminToken = jwt.sign({ sub: 'usr_admin' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
    priyaToken = jwt.sign({ sub: 'usr_priya' }, secret, { algorithm: 'HS256', expiresIn: '8h' });
  });

  beforeEach(async () => {
    // Seed test work items across diverse priorities, assignees, and statuses
    // to verify query filtering and exclusions in backend
    await pool.query(`
      INSERT INTO work_items (id, team_id, title, description, status, priority, type, created_by, assignee_id, version, created_at)
      VALUES
        ('wi_test_urgent_unassigned', 'team_billing', 'Billing Outage', 'Critical billing issue', 'open', 'critical', 'bug', 'usr_admin', NULL, 1, NOW() + INTERVAL '1 hour'),
        ('wi_test_high_unassigned', 'team_billing', 'High Latency DB', 'High latency issue', 'in_progress', 'high', 'task', 'usr_admin', NULL, 1, NOW() + INTERVAL '1 hour'),
        ('wi_test_urgent_resolved', 'team_billing', 'Old Urgent Resolved', 'Should be excluded', 'resolved', 'critical', 'bug', 'usr_admin', NULL, 1, NOW() + INTERVAL '1 hour'),
        ('wi_test_urgent_closed', 'team_billing', 'Old Urgent Closed', 'Should be excluded', 'closed', 'high', 'task', 'usr_admin', NULL, 1, NOW() + INTERVAL '1 hour'),
        ('wi_test_urgent_assigned', 'team_billing', 'Urgent but assigned', 'Should be excluded', 'open', 'critical', 'bug', 'usr_admin', 'usr_priya', 1, NOW() + INTERVAL '1 hour'),
        ('wi_test_priya_work', 'team_billing', 'Priya active work item', 'Priya task', 'in_progress', 'medium', 'task', 'usr_admin', 'usr_priya', 1, NOW() + INTERVAL '1 hour'),
        ('wi_test_approval', 'team_billing', 'Needs team review', 'Pending approval', 'awaiting_approval', 'medium', 'story', 'usr_admin', NULL, 1, NOW() + INTERVAL '1 hour')
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        assignee_id = EXCLUDED.assignee_id,
        created_at = EXCLUDED.created_at;
    `);
  });

  describe('1. Filter State & Chips Parity (Frontend Single Source of Truth)', () => {
    const mockTeams = [{ id: 'team_billing', name: 'Billing & Payments' }];
    const mockUsers = [
      { id: 'usr_priya', name: 'Priya Sharma' },
      { id: 'usr_marcus', name: 'Marcus Chen' },
    ];

    it('clicking "Unassigned Urgent" sets state, generates exact chips, and matches server query string', () => {
      // 1. Sidebar view sets the filter state directly
      const filters = getViewFilters('unassigned_urgent');
      expect(filters).toEqual({
        status: '',
        priority: 'critical,high',
        team_id: '',
        assignee: 'unassigned',
        exclude_status: 'resolved,closed',
      });

      // 2. Chips displayed correspond one-to-one with active filter parameters
      const chips = getFilterChips(filters, mockTeams, mockUsers, 'usr_priya');
      const chipLabels = chips.map((c) => c.label);

      expect(chipLabels).toContain('Assignee: Unassigned');
      expect(chipLabels).toContain('Priority: Critical');
      expect(chipLabels).toContain('Priority: High');
      expect(chipLabels).toContain('Exclude: Resolved, Closed');
      expect(chips).toHaveLength(4);

      // 3. Query string sent to server is built solely from that filter state
      const queryString = buildQueryString(filters);
      const searchParams = new URLSearchParams(queryString);

      expect(searchParams.get('assignee')).toBe('unassigned');
      expect(searchParams.get('priority')).toBe('critical,high');
      expect(searchParams.get('exclude_status')).toBe('resolved,closed');
      expect(searchParams.has('status')).toBe(false);
      expect(searchParams.has('team_id')).toBe(false);

      // 4. View detection highlights "Unassigned Urgent"
      expect(detectActiveView(filters, '', 'usr_priya')).toBe('unassigned_urgent');
      expect(VIEW_TITLES[detectActiveView(filters, '', 'usr_priya')]).toBe('Unassigned Urgent');
    });

    it('removing a priority chip updates filter state, updates query string, and switches view to custom', () => {
      const filters = getViewFilters('unassigned_urgent');
      const chips = getFilterChips(filters, mockTeams, mockUsers, 'usr_priya');

      // Find the "Priority: Critical" chip and apply its removal
      const criticalChip = chips.find((c) => c.key === 'priority-critical')!;
      expect(criticalChip).toBeDefined();

      const updatedFilters: FilterState = {
        ...filters,
        [criticalChip.paramKey]: criticalChip.nextValue,
      };

      // Remaining priority is 'high'
      expect(updatedFilters.priority).toBe('high');

      // Remaining chips: Assignee, Priority: High, Exclude
      const updatedChips = getFilterChips(updatedFilters, mockTeams, mockUsers, 'usr_priya');
      const updatedLabels = updatedChips.map((c) => c.label);
      expect(updatedLabels).toContain('Assignee: Unassigned');
      expect(updatedLabels).toContain('Priority: High');
      expect(updatedLabels).not.toContain('Priority: Critical');
      expect(updatedLabels).toContain('Exclude: Resolved, Closed');

      // Query string updated
      const queryString = buildQueryString(updatedFilters);
      const searchParams = new URLSearchParams(queryString);
      expect(searchParams.get('priority')).toBe('high');
      expect(searchParams.get('assignee')).toBe('unassigned');

      // Changing any filter while on a view switches to custom filter
      expect(detectActiveView(updatedFilters, '', 'usr_priya')).toBe('custom');
      expect(VIEW_TITLES[detectActiveView(updatedFilters, '', 'usr_priya')]).toBe('Custom Filter');
    });

    it('clicking "My Work" sets assignee to current user, shows "Assigned to me" chip, and detects "my_work"', () => {
      const filters = getViewFilters('my_work', 'usr_priya');
      expect(filters.assignee).toBe('usr_priya');
      expect(filters.status).toBe('');
      expect(filters.priority).toBe('');

      // Chip displayed shows "Assignee: Assigned to me"
      const chips = getFilterChips(filters, mockTeams, mockUsers, 'usr_priya');
      expect(chips).toHaveLength(1);
      expect(chips[0].label).toBe('Assignee: Assigned to me');

      // Query string sent
      const queryString = buildQueryString(filters);
      const searchParams = new URLSearchParams(queryString);
      expect(searchParams.get('assignee')).toBe('usr_priya');

      // Sidebar view detected
      expect(detectActiveView(filters, '', 'usr_priya')).toBe('my_work');
      expect(VIEW_TITLES[detectActiveView(filters, '', 'usr_priya')]).toBe('My Work');

      // Changing a dropdown switches view to custom
      const withPriority: FilterState = { ...filters, priority: 'critical' };
      expect(detectActiveView(withPriority, '', 'usr_priya')).toBe('custom');
    });

    it('clicking "Needs Approval" sets status to awaiting_approval and builds matching query', () => {
      const filters = getViewFilters('needs_approval');
      expect(filters.status).toBe('awaiting_approval');
      expect(filters.assignee).toBe('');

      const chips = getFilterChips(filters, mockTeams, mockUsers, 'usr_priya');
      expect(chips).toHaveLength(1);
      expect(chips[0].label).toBe('Status: Awaiting approval');

      const queryString = buildQueryString(filters);
      expect(queryString).toBe('status=awaiting_approval');

      expect(detectActiveView(filters, '', 'usr_priya')).toBe('needs_approval');
    });

    it('clicking "All Items" clears all filters and generates empty query string', () => {
      const filters = getViewFilters('all');
      expect(filters).toEqual(DEFAULT_FILTERS);

      const chips = getFilterChips(filters, mockTeams, mockUsers, 'usr_priya');
      expect(chips).toHaveLength(0);

      const queryString = buildQueryString(filters);
      expect(queryString).toBe('');

      expect(detectActiveView(filters, '', 'usr_priya')).toBe('all');
      expect(VIEW_TITLES[detectActiveView(filters, '', 'usr_priya')]).toBe('All Items');
    });
  });

  describe('2. Backend Query Execution with Filter Query Parameters', () => {
    it('executes "Unassigned Urgent" query: excludes resolved and closed, filters priority critical,high, unassigned only', async () => {
      const filters = getViewFilters('unassigned_urgent');
      const queryParams = buildFilterQueryParams(filters);

      const res = await request(app)
        .get('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .query(queryParams);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();

      const items = res.body.items;
      expect(items.length).toBeGreaterThan(0);

      // Verify all returned items satisfy the unassigned urgent conditions
      for (const item of items) {
        expect(item.assignee_id).toBeNull();
        expect(['critical', 'high']).toContain(item.priority);
        expect(['resolved', 'closed']).not.toContain(item.status);
      }

      // Check specific seeded items
      const itemIds = items.map((i: any) => i.id);
      expect(itemIds).toContain('wi_test_urgent_unassigned');
      expect(itemIds).toContain('wi_test_high_unassigned');
      expect(itemIds).not.toContain('wi_test_urgent_resolved'); // Excluded
      expect(itemIds).not.toContain('wi_test_urgent_closed'); // Excluded
      expect(itemIds).not.toContain('wi_test_urgent_assigned'); // Excluded (has assignee)
    });

    it('executes "My Work" query with assignee=me: returns only items assigned to caller', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('Authorization', `Bearer ${priyaToken}`)
        .query({ assignee: 'me' });

      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item.assignee_id).toBe('usr_priya');
      }

      const itemIds = res.body.items.map((i: any) => i.id);
      expect(itemIds).toContain('wi_test_priya_work');
      expect(itemIds).not.toContain('wi_test_urgent_unassigned');
    });

    it('executes "Needs Approval" query with status=awaiting_approval', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ status: 'awaiting_approval' });

      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item.status).toBe('awaiting_approval');
      }

      const itemIds = res.body.items.map((i: any) => i.id);
      expect(itemIds).toContain('wi_test_approval');
    });
  });
});
