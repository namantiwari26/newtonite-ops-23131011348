import crypto from 'crypto';
import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import { can, AuthUser } from '../auth/can.js';
import { CursorPayload, WorkItem, Comment, ActivityEvent, WorkItemStatus } from '../types.js';

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['awaiting_approval'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function decodeCursor(cursorStr: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursorStr, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.created_at && parsed.id) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ListItemsFilters {
  team_id?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  exclude_status?: string;
  search?: string;
}

/**
 * Keyset cursor pagination across work items with composite index scanning.
 */
export async function listItems(
  filters: ListItemsFilters,
  limit: number,
  cursor: CursorPayload | null,
  user: AuthUser
): Promise<{
  items: WorkItem[];
  total_count: number;
  has_more: boolean;
  next_cursor: string | null;
}> {
  let allowedTeamIds: string[] = [];
  if (user.is_admin) {
    if (filters.team_id) {
      allowedTeamIds = [filters.team_id];
    }
  } else {
    const userTeamIds = user.memberships.map((m) => m.team_id);
    if (filters.team_id) {
      if (!userTeamIds.includes(filters.team_id)) {
        throw new AppError('NOT_FOUND', 'Team not found.', 404);
      }
      allowedTeamIds = [filters.team_id];
    } else {
      allowedTeamIds = userTeamIds;
    }
  }

  if (!user.is_admin && allowedTeamIds.length === 0) {
    return { items: [], next_cursor: null, has_more: false, total_count: 0 };
  }

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (allowedTeamIds.length > 0) {
    conditions.push(`w.team_id = ANY($${paramIdx++})`);
    params.push(allowedTeamIds);
  }

  if (filters.status) {
    const statuses = filters.status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) {
      conditions.push(`w.status = $${paramIdx++}`);
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push(`w.status = ANY($${paramIdx++})`);
      params.push(statuses);
    }
  }

  if (filters.exclude_status) {
    const excluded = filters.exclude_status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (excluded.length === 1) {
      conditions.push(`w.status != $${paramIdx++}`);
      params.push(excluded[0]);
    } else if (excluded.length > 1) {
      conditions.push(`w.status != ALL($${paramIdx++})`);
      params.push(excluded);
    }
  }

  if (filters.priority) {
    const priorities = filters.priority
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (priorities.length === 1) {
      conditions.push(`w.priority = $${paramIdx++}`);
      params.push(priorities[0]);
    } else if (priorities.length > 1) {
      conditions.push(`w.priority = ANY($${paramIdx++})`);
      params.push(priorities);
    }
  }

  if (filters.assignee === 'unassigned') {
    conditions.push(`w.assignee_id IS NULL`);
  } else if (filters.assignee === 'me') {
    conditions.push(`w.assignee_id = $${paramIdx++}`);
    params.push(user.id);
  } else if (filters.assignee) {
    conditions.push(`w.assignee_id = $${paramIdx++}`);
    params.push(filters.assignee);
  }

  if (filters.search) {
    conditions.push(
      `(to_tsvector('english', w.title || ' ' || w.description) @@ plainto_tsquery('english', $${paramIdx}) OR w.title ILIKE $${paramIdx + 1})`
    );
    params.push(filters.search, `%${filters.search}%`);
    paramIdx += 2;
  }

  if (cursor) {
    conditions.push(`(w.created_at, w.id) < ($${paramIdx++}, $${paramIdx++})`);
    params.push(cursor.created_at, cursor.id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countParams = cursor ? params.slice(0, params.length - 2) : params;
  const countConditions = cursor ? conditions.slice(0, conditions.length - 1) : conditions;
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM work_items w ${countWhere}`,
    countParams
  );
  const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);

  const querySql = `
    SELECT 
      w.id, w.team_id, w.title, w.description, w.type, w.status, w.priority,
      w.assignee_id, u_assignee.name AS assignee_name,
      w.created_by, u_creator.name AS creator_name,
      w.due_date, w.version, w.created_at, w.updated_at
    FROM work_items w
    LEFT JOIN users u_assignee ON w.assignee_id = u_assignee.id
    LEFT JOIN users u_creator ON w.created_by = u_creator.id
    ${whereClause}
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT $${paramIdx};
  `;
  params.push(limit + 1);

  const result = await pool.query<WorkItem>(querySql, params);
  const rows = result.rows;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor({
      created_at: last.created_at,
      id: last.id,
    });
  }

  return { items, total_count: totalCount, has_more: hasMore, next_cursor: nextCursor };
}

export async function getRawItem(id: string): Promise<WorkItem | null> {
  const result = await pool.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function getItemDetail(
  id: string
): Promise<{ item: WorkItem; activity_events: ActivityEvent[]; comments: Comment[] }> {
  const itemResult = await pool.query<WorkItem>(
    `SELECT 
       w.id, w.team_id, w.title, w.description, w.type, w.status, w.priority,
       w.assignee_id, u_assignee.name AS assignee_name,
       w.created_by, u_creator.name AS creator_name,
       w.due_date, w.version, w.created_at, w.updated_at
     FROM work_items w
     LEFT JOIN users u_assignee ON w.assignee_id = u_assignee.id
     LEFT JOIN users u_creator ON w.created_by = u_creator.id
     WHERE w.id = $1`,
    [id]
  );

  if (itemResult.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Work item not found', 404);
  }

  const eventsResult = await pool.query<ActivityEvent>(
    `SELECT a.id, a.item_id, a.actor_id, u.name AS actor_name, a.action, a.details, a.created_at
     FROM activity_events a
     LEFT JOIN users u ON a.actor_id = u.id
     WHERE a.item_id = $1
     ORDER BY a.created_at ASC`,
    [id]
  );

  const commentsResult = await pool.query<Comment>(
    `SELECT c.id, c.item_id, c.user_id, u.name AS user_name, c.content, c.created_at
     FROM comments c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.item_id = $1
     ORDER BY c.created_at ASC`,
    [id]
  );

  return {
    item: itemResult.rows[0],
    activity_events: eventsResult.rows,
    comments: commentsResult.rows,
  };
}

export async function checkTeamExists(teamId: string): Promise<boolean> {
  const result = await pool.query('SELECT id FROM teams WHERE id = $1', [teamId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Creates a work item, initial activity event, and outbox notification atomically.
 */
export async function createItem(
  data: {
    team_id: string;
    title: string;
    description?: string | null;
    type?: string;
    priority?: string;
    due_date?: string | null;
  },
  user: AuthUser
): Promise<WorkItem> {
  const itemId = `itm_${crypto.randomUUID().replace(/-/g, '').substring(0, 10)}`;
  const activityId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  return withTransaction(async (client) => {
    const itemResult = await client.query<WorkItem>(
      `INSERT INTO work_items (id, team_id, title, description, type, priority, status, created_by, due_date, version)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, 1)
       RETURNING *;`,
      [
        itemId,
        data.team_id,
        data.title.trim(),
        (data.description || '').trim(),
        data.type || 'task',
        data.priority || 'medium',
        user.id,
        data.due_date || null,
      ]
    );

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'created', $4);`,
      [
        activityId,
        itemId,
        user.id,
        JSON.stringify({
          title: data.title,
          priority: data.priority || 'medium',
          team_id: data.team_id,
          actor_name: user.name,
        }),
      ]
    );

    await client.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
       VALUES ($1, 'ITEM_CREATED_NOTIFICATION', $2, 'pending', 0, 3, NOW());`,
      [
        outboxId,
        JSON.stringify({
          item_id: itemId,
          team_id: data.team_id,
          title: data.title,
          created_by: user.id,
        }),
      ]
    );

    return itemResult.rows[0];
  });
}

/**
 * Atomically claims an item using conditional UPDATE on assignee_id IS NULL and version.
 * If 0 rows updated, queries the row to return an exact 409 diagnostic (already claimed vs version conflict).
 */
export async function claimItem(id: string, version: number, user: AuthUser): Promise<WorkItem> {
  const activityId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  return withTransaction(async (client) => {
    const updateResult = await client.query<WorkItem>(
      `UPDATE work_items 
       SET assignee_id = $1, status = 'in_progress', version = version + 1, updated_at = NOW() 
       WHERE id = $2 AND assignee_id IS NULL AND version = $3 
       RETURNING *;`,
      [user.id, id, version]
    );

    if (updateResult.rowCount === 0) {
      const freshResult = await client.query<{ version: number; assignee_id: string | null }>(
        'SELECT version, assignee_id FROM work_items WHERE id = $1',
        [id]
      );

      if (freshResult.rowCount === 0) {
        throw new AppError('NOT_FOUND', 'Work item not found', 404);
      }

      const fresh = freshResult.rows[0];
      if (fresh.assignee_id !== null) {
        throw new AppError(
          'ALREADY_CLAIMED',
          `Item has already been claimed by user '${fresh.assignee_id}'.`,
          409,
          {
            current_assignee: fresh.assignee_id,
          }
        );
      }

      if (fresh.version !== version) {
        throw new AppError(
          'OPTIMISTIC_LOCK_CONFLICT',
          'This item was changed by someone else. Reload.',
          409,
          {
            current_version: fresh.version,
          }
        );
      }

      throw new AppError('CONFLICT', 'Claim failed due to concurrency conflict.', 409);
    }

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'claimed', $4);`,
      [
        activityId,
        id,
        user.id,
        JSON.stringify({
          claimed_by: user.id,
          actor_name: user.name,
          new_status: 'in_progress',
        }),
      ]
    );

    await client.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
       VALUES ($1, 'ITEM_CLAIMED_NOTIFICATION', $2, 'pending', 0, 3, NOW());`,
      [
        outboxId,
        JSON.stringify({
          item_id: id,
          claimed_by: user.id,
          claimed_at: new Date().toISOString(),
        }),
      ]
    );

    return updateResult.rows[0];
  });
}

/**
 * Optimistically updates work item attributes, logging granular changes to activity_events.
 */
export async function updateItem(
  id: string,
  version: number,
  updates: {
    title?: string;
    description?: string | null;
    priority?: string;
    status?: string;
    assignee_id?: string | null;
    due_date?: string | null;
  },
  user: AuthUser
): Promise<WorkItem> {
  const activityId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  return withTransaction(async (client) => {
    // Lock row to read baseline state for diff generation
    const currentResult = await client.query<WorkItem>(
      'SELECT * FROM work_items WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (currentResult.rowCount === 0) {
      throw new AppError('NOT_FOUND', 'Work item not found', 404);
    }

    const currentItem = currentResult.rows[0];
    const newTitle = updates.title !== undefined ? updates.title.trim() : currentItem.title;
    const newDescription =
      updates.description !== undefined
        ? (updates.description || '').trim()
        : currentItem.description;
    const newPriority = updates.priority !== undefined ? updates.priority : currentItem.priority;
    const newStatus = updates.status !== undefined ? updates.status : currentItem.status;
    const newAssignee =
      updates.assignee_id !== undefined ? updates.assignee_id : currentItem.assignee_id;
    const newDueDate = updates.due_date !== undefined ? updates.due_date : currentItem.due_date;

    const changes: Record<string, { from: any; to: any }> = {};
    if (updates.title !== undefined && updates.title.trim() !== currentItem.title) {
      changes.title = { from: currentItem.title, to: newTitle };
    }
    if (updates.priority !== undefined && updates.priority !== currentItem.priority) {
      changes.priority = { from: currentItem.priority, to: newPriority };
    }
    if (updates.status !== undefined && updates.status !== currentItem.status) {
      changes.status = { from: currentItem.status, to: newStatus };
    }
    if (updates.assignee_id !== undefined && updates.assignee_id !== currentItem.assignee_id) {
      changes.assignee_id = { from: currentItem.assignee_id, to: newAssignee };
    }
    if (updates.due_date !== undefined && updates.due_date !== currentItem.due_date) {
      changes.due_date = { from: currentItem.due_date, to: newDueDate };
    }

    const updateResult = await client.query<WorkItem>(
      `UPDATE work_items
       SET title = $1, description = $2, priority = $3, status = $4, assignee_id = $5, due_date = $6,
           version = version + 1, updated_at = NOW()
       WHERE id = $7 AND version = $8
       RETURNING *;`,
      [newTitle, newDescription, newPriority, newStatus, newAssignee, newDueDate, id, version]
    );

    if (updateResult.rowCount === 0) {
      const freshResult = await client.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [
        id,
      ]);
      const fresh = freshResult.rows[0];
      throw new AppError(
        'OPTIMISTIC_LOCK_CONFLICT',
        'This item was changed by someone else. Reload.',
        409,
        {
          item: fresh,
          current_version: fresh?.version,
        }
      );
    }

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'updated', $4);`,
      [
        activityId,
        id,
        user.id,
        JSON.stringify({
          changes: Object.keys(changes).length > 0 ? changes : { properties: 'updated' },
          actor_name: user.name,
        }),
      ]
    );

    await client.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
       VALUES ($1, 'ITEM_UPDATED_SYNC', $2, 'pending', 0, 3, NOW());`,
      [
        outboxId,
        JSON.stringify({
          item_id: id,
          updated_by: user.id,
          version: updateResult.rows[0].version,
        }),
      ]
    );

    return updateResult.rows[0];
  });
}

/**
 * Inserts comment and audit record in the same database transaction.
 */
export async function addComment(
  itemId: string,
  content: string,
  user: AuthUser
): Promise<Comment> {
  const commentId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const trimmedContent = content.trim();

  return withTransaction(async (client) => {
    const commentResult = await client.query<Comment>(
      `INSERT INTO comments (id, item_id, user_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *;`,
      [commentId, itemId, user.id, trimmedContent]
    );

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'comment', $4);`,
      [
        activityId,
        itemId,
        user.id,
        JSON.stringify({
          comment_id: commentId,
          actor: user.name,
          actor_name: user.name,
          content: trimmedContent,
        }),
      ]
    );

    return { ...commentResult.rows[0], user_name: user.name };
  });
}

/**
 * Validates and executes a status lifecycle transition using row-level locking (SELECT FOR UPDATE).
 */
export async function transitionItem(
  id: string,
  to: WorkItemStatus,
  version: number,
  user: AuthUser
): Promise<WorkItem> {
  return withTransaction(async (client) => {
    // Lock row to evaluate allowed transitions and version atomically
    const currentResult = await client.query<WorkItem>(
      'SELECT * FROM work_items WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (currentResult.rowCount === 0) {
      throw new AppError('NOT_FOUND', 'Work item not found', 404);
    }

    const currentItem = currentResult.rows[0];

    // Verify tenant boundary
    if (!can(user, 'view', currentItem)) {
      throw new AppError('NOT_FOUND', 'Work item not found', 404);
    }

    // Verify general transition capability
    if (!can(user, 'transition', currentItem)) {
      throw new AppError('FORBIDDEN', 'Viewers cannot transition work items.', 403);
    }

    // Verify allowed lifecycle transitions
    const allowed = ALLOWED_TRANSITIONS[currentItem.status] || [];
    if (!allowed.includes(to)) {
      throw new AppError(
        'INVALID_TRANSITION',
        `Invalid status transition from '${currentItem.status}' to '${to}'. Allowed transitions: ${allowed.join(', ') || 'none'}.`,
        409
      );
    }

    // Approving or rejecting requires lead/admin approval permission
    if (currentItem.status === 'awaiting_approval' && (to === 'resolved' || to === 'in_progress')) {
      if (!can(user, 'approve', currentItem)) {
        throw new AppError(
          'FORBIDDEN',
          'Only team leads and administrators can approve or reject items.',
          403
        );
      }
    }

    // Verify optimistic concurrency version on locked row
    if (currentItem.version !== version) {
      throw new AppError(
        'OPTIMISTIC_LOCK_CONFLICT',
        'This item was changed by someone else. Reload.',
        409,
        {
          item: currentItem,
          current_version: currentItem.version,
        }
      );
    }

    const activityId = crypto.randomUUID();
    const outboxId = crypto.randomUUID();

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'transition', $4);`,
      [
        activityId,
        id,
        user.id,
        JSON.stringify({
          actor: user.name,
          actor_name: user.name,
          from: currentItem.status,
          to,
        }),
      ]
    );

    await client.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
       VALUES ($1, 'ITEM_STATUS_TRANSITIONED', $2, 'pending', 0, 3, NOW());`,
      [
        outboxId,
        JSON.stringify({
          item_id: id,
          actor: user.id,
          from: currentItem.status,
          to,
        }),
      ]
    );

    const updateResult = await client.query<WorkItem>(
      `UPDATE work_items 
       SET status = $1, version = version + 1, updated_at = NOW() 
       WHERE id = $2 AND version = $3 
       RETURNING *;`,
      [to, id, version]
    );

    return updateResult.rows[0];
  });
}

export async function deleteItem(id: string): Promise<WorkItem> {
  const result = await pool.query<WorkItem>('DELETE FROM work_items WHERE id = $1 RETURNING *;', [
    id,
  ]);
  if (result.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Work item not found', 404);
  }
  return result.rows[0];
}
