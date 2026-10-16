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
  | 'resolve'
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
 * Role by Action Matrix:
 * 
 * | Action   | Viewer | Member | Lead | Admin |
 * | :------- | :----: | :----: | :--: | :---: |
 * | view     |   ✔    |   ✔    |  ✔   |   ✔   |
 * | comment  |   ✔    |   ✔    |  ✔   |   ✔   |
 * | create   |   ✖    |   ✔    |  ✔   |   ✔   |
 * | update   |   ✖    |   ✔    |  ✔   |   ✔   |
 * | claim    |   ✖    |   ✔    |  ✔   |   ✔   |
 * | resolve  |   ✖    |   ✔    |  ✔   |   ✔   |
 * | delete   |   ✖    |   ✖    |  ✔   |   ✔   |
 * 
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
    // User is outside the item's team -> not authorized
    return false;
  }

  // 3. Evaluate permissions based on team role
  switch (membership.role) {
    case 'lead':
      // Team leads can perform all actions within their team
      return true;

    case 'member':
      // Team members can view, create, update, claim, comment, and resolve, but cannot delete
      if (action === 'delete') {
        return false;
      }
      return true;

    case 'viewer':
      // Viewers can view items and comment, but cannot mutate status/fields
      return action === 'view' || action === 'comment';

    default:
      return false;
  }
}
