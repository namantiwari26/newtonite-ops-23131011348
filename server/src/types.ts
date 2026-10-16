/**
 * Shared Type Definitions for Workdesk
 */

export type WorkItemStatus = 'open' | 'in_progress' | 'blocked' | 'resolved' | 'closed';
export type WorkItemPriority = 'low' | 'medium' | 'high' | 'critical';
export type WorkItemType = 'task' | 'bug' | 'feature' | 'incident';

export interface User {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface TeamMembership {
  team_id: string;
  user_id: string;
  role: 'lead' | 'member' | 'viewer';
  created_at: string;
}

export interface WorkItem {
  id: string;
  team_id: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assignee_id: string | null;
  assignee_name?: string | null;
  created_by: string;
  creator_name?: string;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  item_id: string;
  user_id: string;
  user_name?: string;
  content: string;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  item_id: string;
  actor_id: string;
  actor_name?: string;
  action: string;
  details: Record<string, any>;
  created_at: string;
}

export interface OutboxEvent {
  id: string;
  event_type: string;
  payload: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_run_at: string;
  created_at: string;
  processed_at: string | null;
}

export interface CursorPayload {
  created_at: string;
  id: string;
}
