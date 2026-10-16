/**
 * Authorization engine for Workdesk.
 *
 * Roles live only in team memberships (viewer, member, lead) plus an is_admin boolean on users.
 * All authorization is enforced through this single can(user, action, item) function.
 */

export type Action =
  | 'view'
  | 'create'
  | 'update'
  | 'claim'
  | 'transition'
  | 'approve'
  | 'delete'
  | 'comment';

export interface UserTeamMembership {
  team_id: string;
  role: 'lead' | 'member' | 'viewer';
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  memberships: UserTeamMembership[];
}

export interface WorkItemTarget {
  id?: string;
  team_id: string;
  status?: string;
  assignee_id?: string | null;
  created_by?: string;
}

/**
 * Updated Role by Action Matrix:
 * 
 * | Action     | Viewer | Member | Lead | Admin |
 * | :--------- | :----: | :----: | :--: | :---: |
 * | view       |   ✔    |   ✔    |  ✔   |   ✔   |
 * | comment    |   ✔    |   ✔    |  ✔   |   ✔   |
 * | create     |   ✖    |   ✔    |  ✔   |   ✔   |
 * | update     |   ✖    |   ✔    |  ✔   |   ✔   |
 * | claim      |   ✖    |   ✔    |  ✔   |   ✔   |
 * | transition |   ✖    |   ✔    |  ✔   |   ✔   |
 * | approve    |   ✖    |   ✖    |  ✔   |   ✔   |
 * | delete     |   ✖    |   ✖    |  ✔   |   ✔   |
 * 
 * Note: Members can move items up to awaiting_approval via 'transition'.
 * Approving (awaiting_approval -> resolved) or rejecting (awaiting_approval -> in_progress)
 * requires 'approve', which is restricted exclusively to Team Leads and Administrators.
 * Users outside an item's team have no membership and receive false (resulting in 404).
 */
export function can(
  user: AuthUser,
  action: Action,
  item: WorkItemTarget
): boolean {
  if (!user || !user.id || !item || !item.team_id) {
    return false;
  }

  // 1. System administrators have full permission across all teams
  if (user.is_admin) {
    return true;
  }

  // 2. Find user's membership in the target item's team
  const membership = user.memberships.find((m) => m.team_id === item.team_id);
  if (!membership) {
    // User is outside the item's team -> not authorized (triggers 404)
    return false;
  }

  // 3. Evaluate permissions based on team role
  switch (membership.role) {
    case 'lead':
      // Team leads can perform all actions within their team including approve and delete
      return true;

    case 'member':
      // Team members can view, create, update, claim, comment, and transition (up to awaiting_approval).
      // They CANNOT delete or approve/reject.
      if (action === 'delete' || action === 'approve') {
        return false;
      }
      return true;

    case 'viewer':
      // Viewers can view items and comment, but cannot mutate items
      return action === 'view' || action === 'comment';

    default:
      return false;
  }
}
