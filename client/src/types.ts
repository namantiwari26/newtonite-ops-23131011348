export interface User {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  memberships: Array<{
    team_id: string;
    role: 'lead' | 'member' | 'viewer';
  }>;
}

export interface Team {
  id: string;
  name: string;
  description: string;
}

export const WORK_ITEM_STATUSES = [
  'open',
  'in_progress',
  'awaiting_approval',
  'resolved',
  'closed',
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_approval: 'Awaiting Approval',
  resolved: 'Resolved',
  closed: 'Closed',
};

export interface WorkItem {
  id: string;
  team_id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee_id: string | null;
  assignee_name?: string | null;
  created_by: string;
  creator_name?: string;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
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

export interface Comment {
  id: string;
  item_id: string;
  user_id: string;
  user_name?: string;
  content: string;
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
