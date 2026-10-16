import { describe, it, expect } from 'vitest';
import { can, AuthUser } from '../auth/can.js';

describe('Workdesk - can(user, action, item) Role Matrix', () => {
  const adminUser: AuthUser = {
    id: 'usr_admin',
    name: 'Alex Vance',
    email: 'alex.vance@workdesk.test',
    is_admin: true,
    memberships: [],
  };

  const leadBilling: AuthUser = {
    id: 'usr_priya',
    name: 'Priya Sharma',
    email: 'priya.sharma@workdesk.test',
    is_admin: false,
    memberships: [{ team_id: 'team_billing', role: 'lead' }],
  };

  const memberBilling: AuthUser = {
    id: 'usr_marcus',
    name: 'Marcus Chen',
    email: 'marcus.chen@workdesk.test',
    is_admin: false,
    memberships: [{ team_id: 'team_billing', role: 'member' }],
  };

  const viewerSupport: AuthUser = {
    id: 'usr_david',
    name: 'David Morales',
    email: 'david.morales@workdesk.test',
    is_admin: false,
    memberships: [{ team_id: 'team_support', role: 'viewer' }],
  };

  const itemBilling = {
    id: 'itm_001',
    team_id: 'team_billing',
    assignee_id: null,
  };

  const itemPlatform = {
    id: 'itm_002',
    team_id: 'team_platform',
    assignee_id: null,
  };

  const itemSupport = {
    id: 'itm_003',
    team_id: 'team_support',
    assignee_id: null,
  };

  it('allows system admin full access across all teams and actions', () => {
    expect(can(adminUser, 'view', itemBilling)).toBe(true);
    expect(can(adminUser, 'create', itemBilling)).toBe(true);
    expect(can(adminUser, 'claim', itemBilling)).toBe(true);
    expect(can(adminUser, 'update', itemBilling)).toBe(true);
    expect(can(adminUser, 'transition', itemBilling)).toBe(true);
    expect(can(adminUser, 'approve', itemBilling)).toBe(true);
    expect(can(adminUser, 'delete', itemBilling)).toBe(true);
    expect(can(adminUser, 'delete', itemPlatform)).toBe(true);
  });

  it('denies access if user is outside the item team', () => {
    expect(can(leadBilling, 'view', itemPlatform)).toBe(false);
    expect(can(leadBilling, 'create', itemPlatform)).toBe(false);
    expect(can(leadBilling, 'claim', itemPlatform)).toBe(false);
    expect(can(leadBilling, 'transition', itemPlatform)).toBe(false);
    expect(can(leadBilling, 'approve', itemPlatform)).toBe(false);
    expect(can(memberBilling, 'view', itemPlatform)).toBe(false);
  });

  it('allows team lead full permissions within their own team including approve and delete', () => {
    expect(can(leadBilling, 'view', itemBilling)).toBe(true);
    expect(can(leadBilling, 'create', itemBilling)).toBe(true);
    expect(can(leadBilling, 'claim', itemBilling)).toBe(true);
    expect(can(leadBilling, 'update', itemBilling)).toBe(true);
    expect(can(leadBilling, 'transition', itemBilling)).toBe(true);
    expect(can(leadBilling, 'approve', itemBilling)).toBe(true);
    expect(can(leadBilling, 'delete', itemBilling)).toBe(true);
    expect(can(leadBilling, 'comment', itemBilling)).toBe(true);
  });

  it('allows team member to transition items up to awaiting_approval, but forbids approve and delete', () => {
    expect(can(memberBilling, 'view', itemBilling)).toBe(true);
    expect(can(memberBilling, 'create', itemBilling)).toBe(true);
    expect(can(memberBilling, 'claim', itemBilling)).toBe(true);
    expect(can(memberBilling, 'update', itemBilling)).toBe(true);
    expect(can(memberBilling, 'transition', itemBilling)).toBe(true);
    expect(can(memberBilling, 'comment', itemBilling)).toBe(true);
    // Members CANNOT approve or delete
    expect(can(memberBilling, 'approve', itemBilling)).toBe(false);
    expect(can(memberBilling, 'delete', itemBilling)).toBe(false);
  });

  it('allows viewers only to view items and comment, denying mutations', () => {
    expect(can(viewerSupport, 'view', itemSupport)).toBe(true);
    expect(can(viewerSupport, 'comment', itemSupport)).toBe(true);
    expect(can(viewerSupport, 'create', itemSupport)).toBe(false);
    expect(can(viewerSupport, 'claim', itemSupport)).toBe(false);
    expect(can(viewerSupport, 'update', itemSupport)).toBe(false);
    expect(can(viewerSupport, 'transition', itemSupport)).toBe(false);
    expect(can(viewerSupport, 'approve', itemSupport)).toBe(false);
    expect(can(viewerSupport, 'delete', itemSupport)).toBe(false);
  });
});
