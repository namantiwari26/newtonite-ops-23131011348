import { WorkItem, ActivityEvent, Comment, User, Team } from './types.js';

const API_BASE = '/api';

/**
 * Helper to execute JSON HTTP requests with JWT Authorization header.
 */
async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('workdesk_token');
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error: any = new Error(data.message || 'API request failed');
    error.status = res.status;
    error.code = data.error;
    error.data = data;
    throw error;
  }

  return data as T;
}

// 1. Authentication API
export async function loginApi(
  email: string,
  password?: string
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: password || 'Demo@12345' }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error: any = new Error(data.message || 'Authentication failed');
    error.status = res.status;
    error.code = data.error;
    throw error;
  }

  return data;
}

export async function fetchCurrentUser(): Promise<{ user: User }> {
  return apiFetch<{ user: User }>('/auth/me');
}

// 2. Metadata API
export async function fetchUsers(): Promise<User[]> {
  const res = await fetch(`${API_BASE}/users`);
  return res.json();
}

export async function fetchTeams(): Promise<Team[]> {
  const res = await fetch(`${API_BASE}/teams`);
  return res.json();
}

// 3. Work Items API
export interface ListItemsParams {
  team_id?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface ListItemsResponse {
  items: WorkItem[];
  next_cursor: string | null;
  has_more: boolean;
  total_count: number;
}

export async function fetchItems(params: ListItemsParams): Promise<ListItemsResponse> {
  const query = new URLSearchParams();
  if (params.team_id) query.set('team_id', params.team_id);
  if (params.status) query.set('status', params.status);
  if (params.priority) query.set('priority', params.priority);
  if (params.assignee) query.set('assignee', params.assignee);
  if (params.search) query.set('search', params.search);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', params.limit.toString());

  return apiFetch<ListItemsResponse>(`/items?${query.toString()}`);
}

export async function fetchItemDetail(
  id: string
): Promise<{ item: WorkItem; activity_events: ActivityEvent[]; comments: Comment[] }> {
  return apiFetch<{ item: WorkItem; activity_events: ActivityEvent[]; comments: Comment[] }>(
    `/items/${id}`
  );
}

export async function createItem(
  payload: {
    team_id: string;
    title: string;
    description: string;
    priority: string;
    due_date?: string;
  },
  idempotencyKey: string
): Promise<{ item: WorkItem }> {
  return apiFetch<{ item: WorkItem }>('/items', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

export async function claimItem(id: string, version: number): Promise<{ item: WorkItem }> {
  return apiFetch<{ item: WorkItem }>(`/items/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function updateItem(
  id: string,
  payload: {
    title?: string;
    description?: string;
    priority?: string;
    status?: string;
    assignee_id?: string | null;
    due_date?: string | null;
    version: number;
  }
): Promise<{ item: WorkItem }> {
  return apiFetch<{ item: WorkItem }>(`/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function transitionItem(
  id: string,
  to: string,
  version: number
): Promise<{ item: WorkItem }> {
  return apiFetch<{ item: WorkItem }>(`/items/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to, version }),
  });
}

export async function addComment(itemId: string, content: string): Promise<{ comment: Comment }> {
  return apiFetch<{ comment: Comment }>(`/items/${itemId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
