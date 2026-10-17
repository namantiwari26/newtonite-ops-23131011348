import crypto from 'crypto';
import { Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool.js';
import { can } from '../auth/can.js';
import { CursorPayload, WorkItem, Comment } from '../types.js';

// Helper to encode and decode base64 cursor for keyset pagination
function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function decodeCursor(cursorStr: string): CursorPayload | null {
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

/**
 * GET /api/items
 * Keyset cursor pagination with server-side filters on work_items.
 */
export async function listItems(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const teamId = (req.query.team_id as string) || '';
  const status = (req.query.status as string) || '';
  const priority = (req.query.priority as string) || '';
  const assignee = (req.query.assignee as string) || '';
  const search = (req.query.search as string) || '';
  const rawLimit = parseInt(req.query.limit as string, 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 10 : rawLimit, 1), 50);
  const cursorStr = (req.query.cursor as string) || '';

  // Task 2: Users outside an item's team get 404
  let allowedTeamIds: string[] = [];
  if (user.is_admin) {
    if (teamId) {
      allowedTeamIds = [teamId];
    }
  } else {
    const userTeamIds = user.memberships.map((m) => m.team_id);
    if (teamId) {
      if (!userTeamIds.includes(teamId)) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Team not found.',
        });
        return;
      }
      allowedTeamIds = [teamId];
    } else {
      allowedTeamIds = userTeamIds;
    }
  }

  // Non-admins with no team memberships see empty list
  if (!user.is_admin && allowedTeamIds.length === 0) {
    res.json({ items: [], next_cursor: null, has_more: false, total_count: 0 });
    return;
  }

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (allowedTeamIds.length > 0) {
    conditions.push(`w.team_id = ANY($${paramIdx++})`);
    params.push(allowedTeamIds);
  }

  if (status) {
    conditions.push(`w.status = $${paramIdx++}`);
    params.push(status);
  }

  if (priority) {
    conditions.push(`w.priority = $${paramIdx++}`);
    params.push(priority);
  }

  if (assignee === 'unassigned') {
    conditions.push(`w.assignee_id IS NULL`);
  } else if (assignee) {
    conditions.push(`w.assignee_id = $${paramIdx++}`);
    params.push(assignee);
  }

  if (search) {
    // Utilize GIN full-text index and ILIKE fallback
    conditions.push(`(to_tsvector('english', w.title || ' ' || w.description) @@ plainto_tsquery('english', $${paramIdx}) OR w.title ILIKE $${paramIdx + 1})`);
    params.push(search, `%${search}%`);
    paramIdx += 2;
  }

  // Keyset cursor pagination: fetch items older than the cursor
  if (cursorStr) {
    const decoded = decodeCursor(cursorStr);
    if (decoded) {
      conditions.push(`(w.created_at, w.id) < ($${paramIdx++}, $${paramIdx++})`);
      params.push(decoded.created_at, decoded.id);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count for current filter scope
  const countParams = cursorStr ? params.slice(0, params.length - 2) : params;
  const countConditions = cursorStr ? conditions.slice(0, conditions.length - 1) : conditions;
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM work_items w ${countWhere}`,
    countParams
  );
  const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);

  // Keyset query against work_items table
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

  res.json({
    items,
    next_cursor: nextCursor,
    has_more: hasMore,
    total_count: totalCount,
  });
}

/**
 * GET /api/items/:id
 * Retrieve work item by ID with activity events and comments.
 */
export async function getItemById(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { id } = req.params;

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
    res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
    return;
  }

  const item = itemResult.rows[0];

  // Task 2: Users outside an item's team get 404
  if (!can(user, 'view', item)) {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Work item not found',
    });
    return;
  }

  const eventsResult = await pool.query(
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

  res.json({
    item,
    activity_events: eventsResult.rows,
    comments: commentsResult.rows,
  });
}

/**
 * POST /api/items
 * Create a new work item.
 */
export async function createItem(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { team_id, title, description, priority = 'medium', type = 'task', due_date = null } = req.body;

  if (!team_id || !title || !title.trim()) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'team_id and title are required fields.',
    });
    return;
  }

  // Task 2: Check can(user, 'create', { team_id }). Users outside team get 404.
  if (!can(user, 'create', { team_id })) {
    const isMember = user.is_admin || user.memberships.some((m) => m.team_id === team_id);
    if (!isMember) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Team not found' });
      return;
    }
    res.status(403).json({ error: 'FORBIDDEN', message: 'Viewers cannot create work items.' });
    return;
  }

  const itemId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  const createdItem = await withTransaction(async (client) => {
    const insertItemResult = await client.query<WorkItem>(
      `INSERT INTO work_items (id, team_id, title, description, type, status, priority, assignee_id, created_by, due_date, version)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, NULL, $7, $8, 1)
       RETURNING *;`,
      [itemId, team_id, title.trim(), (description || '').trim(), type, priority, user.id, due_date]
    );

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'created', $4);`,
      [
        activityId,
        itemId,
        user.id,
        JSON.stringify({ title, priority, team_id, actor_name: user.name }),
      ]
    );

    await client.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, max_attempts, next_run_at)
       VALUES ($1, 'ITEM_CREATED_NOTIFICATION', $2, 'pending', 0, 3, NOW());`,
      [
        outboxId,
        JSON.stringify({
          item_id: itemId,
          team_id,
          title,
          priority,
          creator: user.name,
        }),
      ]
    );

    return insertItemResult.rows[0];
  });

  res.status(201).json({
    message: 'Work item created successfully',
    item: createdItem,
  });
}

/**
 * POST /api/items/:id/claim
 * Claim an unassigned item.
 */
export async function claimItem(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { id } = req.params;
  const expectedVersion = req.body.expected_version;

  if (typeof expectedVersion !== 'number') {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'expected_version (number) is required for optimistic locking.',
    });
    return;
  }

  const currentResult = await pool.query<WorkItem>(
    'SELECT * FROM work_items WHERE id = $1',
    [id]
  );

  if (currentResult.rowCount === 0) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
    return;
  }

  const currentItem = currentResult.rows[0];

  // Task 2: Users outside an item's team get 404
  if (!can(user, 'claim', currentItem)) {
    const isMember = user.is_admin || user.memberships.some((m) => m.team_id === currentItem.team_id);
    if (!isMember) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }
    res.status(403).json({ error: 'FORBIDDEN', message: 'Viewers cannot claim work items.' });
    return;
  }

  if (currentItem.assignee_id !== null) {
    res.status(409).json({
      error: 'ALREADY_CLAIMED',
      message: `Item has already been claimed by user '${currentItem.assignee_id}'.`,
      current_assignee: currentItem.assignee_id,
    });
    return;
  }

  const activityId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  try {
    const updatedItem = await withTransaction(async (client) => {
      const updateResult = await client.query<WorkItem>(
        `UPDATE work_items 
         SET assignee_id = $1, 
             status = 'in_progress', 
             version = version + 1, 
             updated_at = NOW() 
         WHERE id = $2 
           AND assignee_id IS NULL 
           AND version = $3
         RETURNING *;`,
        [user.id, id, expectedVersion]
      );

      if (updateResult.rowCount === 0) {
        const recheck = await client.query<WorkItem>(
          'SELECT version, assignee_id FROM work_items WHERE id = $1',
          [id]
        );
        if (recheck.rowCount && recheck.rowCount > 0) {
          const fresh = recheck.rows[0];
          if (fresh.assignee_id !== null) {
            const err: any = new Error('ALREADY_CLAIMED');
            err.code = 'ALREADY_CLAIMED';
            err.current_assignee = fresh.assignee_id;
            throw err;
          }
          if (fresh.version !== expectedVersion) {
            const err: any = new Error('OPTIMISTIC_LOCK_CONFLICT');
            err.code = 'OPTIMISTIC_LOCK_CONFLICT';
            err.current_version = fresh.version;
            throw err;
          }
        }
        throw new Error('CLAIM_FAILED');
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
            claimed_by: user.name,
            team_id: currentItem.team_id,
          }),
        ]
      );

      return updateResult.rows[0];
    });

    res.json({
      message: 'Item claimed successfully',
      item: updatedItem,
    });
  } catch (err: any) {
    if (err.code === 'ALREADY_CLAIMED') {
      res.status(409).json({
        error: 'ALREADY_CLAIMED',
        message: 'This item was claimed by another team member.',
        current_assignee: err.current_assignee,
      });
      return;
    }
    if (err.code === 'OPTIMISTIC_LOCK_CONFLICT') {
      res.status(409).json({
        error: 'OPTIMISTIC_LOCK_CONFLICT',
        message: 'Item state was updated by another team member. Please refresh.',
        current_version: err.current_version,
      });
      return;
    }
    throw err;
  }
}

/**
 * PATCH /api/items/:id
 * Update item fields with optimistic locking.
 */
export async function updateItem(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { id } = req.params;
  const { title, description, priority, status, assignee_id, due_date, expected_version } = req.body;

  if (typeof expected_version !== 'number') {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'expected_version (number) is required for optimistic locking.',
    });
    return;
  }

  const currentResult = await pool.query<WorkItem>(
    'SELECT * FROM work_items WHERE id = $1',
    [id]
  );

  if (currentResult.rowCount === 0) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
    return;
  }

  const currentItem = currentResult.rows[0];

  // Task 2: Users outside an item's team get 404
  if (!can(user, 'update', currentItem)) {
    const isMember = user.is_admin || user.memberships.some((m) => m.team_id === currentItem.team_id);
    if (!isMember) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }
    res.status(403).json({ error: 'FORBIDDEN', message: 'Viewers cannot modify work items.' });
    return;
  }

  const newTitle = title !== undefined ? title.trim() : currentItem.title;
  const newDescription = description !== undefined ? description.trim() : currentItem.description;
  const newPriority = priority !== undefined ? priority : currentItem.priority;
  const newStatus = status !== undefined ? status : currentItem.status;
  const newAssignee = assignee_id !== undefined ? assignee_id : currentItem.assignee_id;
  const newDueDate = due_date !== undefined ? due_date : currentItem.due_date;

  const activityId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  try {
    const updatedItem = await withTransaction(async (client) => {
      const updateResult = await client.query<WorkItem>(
        `UPDATE work_items 
         SET title = $1, 
             description = $2, 
             priority = $3, 
             status = $4, 
             assignee_id = $5,
             due_date = $6,
             version = version + 1, 
             updated_at = NOW() 
         WHERE id = $7 AND version = $8 
         RETURNING *;`,
        [newTitle, newDescription, newPriority, newStatus, newAssignee, newDueDate, id, expected_version]
      );

      if (updateResult.rowCount === 0) {
        const fresh = await client.query<WorkItem>(
          'SELECT version FROM work_items WHERE id = $1',
          [id]
        );
        const err: any = new Error('OPTIMISTIC_LOCK_CONFLICT');
        err.code = 'OPTIMISTIC_LOCK_CONFLICT';
        err.current_version = fresh.rows[0]?.version;
        throw err;
      }

      const changes: Record<string, any> = {};
      if (title !== undefined && title.trim() !== currentItem.title) {
        changes.title = { from: currentItem.title, to: newTitle };
      }
      if (description !== undefined && description.trim() !== currentItem.description) {
        changes.description = { from: currentItem.description, to: newDescription };
      }
      if (priority !== undefined && priority !== currentItem.priority) {
        changes.priority = { from: currentItem.priority, to: newPriority };
      }
      if (status !== undefined && status !== currentItem.status) {
        changes.status = { from: currentItem.status, to: newStatus };
      }
      if (assignee_id !== undefined && assignee_id !== currentItem.assignee_id) {
        changes.assignee_id = { from: currentItem.assignee_id, to: newAssignee };
      }
      if (due_date !== undefined && due_date !== currentItem.due_date) {
        changes.due_date = { from: currentItem.due_date, to: newDueDate };
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
            status: newStatus,
            priority: newPriority,
            updated_by: user.name,
          }),
        ]
      );

      return updateResult.rows[0];
    });

    res.json({
      message: 'Work item updated successfully',
      item: updatedItem,
    });
  } catch (err: any) {
    if (err.code === 'OPTIMISTIC_LOCK_CONFLICT') {
      res.status(409).json({
        error: 'OPTIMISTIC_LOCK_CONFLICT',
        message: 'This item was changed by someone else. Reload.',
        current_version: err.current_version,
      });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/items/:id/comments
 * Add a comment to a work item.
 */
export async function addComment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { id } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Comment content cannot be empty.' });
    return;
  }

  const currentResult = await pool.query<WorkItem>('SELECT * FROM work_items WHERE id = $1', [id]);
  if (currentResult.rowCount === 0) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
    return;
  }

  const currentItem = currentResult.rows[0];

  // Task 2: Users outside an item's team get 404
  if (!can(user, 'comment', currentItem)) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
    return;
  }

  const commentId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const trimmedContent = content.trim();

  const comment = await withTransaction(async (client) => {
    const commentResult = await client.query<Comment>(
      `INSERT INTO comments (id, item_id, user_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *;`,
      [commentId, id, user.id, trimmedContent]
    );

    await client.query(
      `INSERT INTO activity_events (id, item_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'comment', $4);`,
      [
        activityId,
        id,
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

  res.status(201).json({ comment });
}

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['awaiting_approval'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

/**
 * POST /api/items/:id/transition
 * Body: { to: string, version: number }
 * 
 * Enforces allowed-transitions map.
 * Members move items up to awaiting_approval.
 * Only Leads of that item's team (or Admins) can approve (awaiting_approval -> resolved) or reject (awaiting_approval -> in_progress).
 * In one transaction: UPDATE ... WHERE id=$2 AND version=$3, activity_events row (actor, from, to), and outbox job.
 * 0 rows updated returns 409 with the latest item.
 */
export async function transitionItem(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { id } = req.params;
  const { to } = req.body;
  const version = typeof req.body.version === 'number' ? req.body.version : req.body.expected_version;

  if (typeof version !== 'number' || !to || typeof to !== 'string') {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'to (string) and version (number) are required.',
    });
    return;
  }

  try {
    const updatedItem = await withTransaction(async (client) => {
      // 1. Move the item read inside the transaction using SELECT * FROM work_items WHERE id=$1 FOR UPDATE
      const currentResult = await client.query<WorkItem>(
        'SELECT * FROM work_items WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (currentResult.rowCount === 0) {
        const err: any = new Error('NOT_FOUND');
        err.statusCode = 404;
        err.payload = { error: 'NOT_FOUND', message: 'Work item not found' };
        throw err;
      }

      const currentItem = currentResult.rows[0];

      // Users outside team get 404
      if (!can(user, 'view', currentItem)) {
        const err: any = new Error('NOT_FOUND');
        err.statusCode = 404;
        err.payload = { error: 'NOT_FOUND', message: 'Work item not found' };
        throw err;
      }

      // 2. Run the allowed-transition and can() checks on that locked row
      const allowed = ALLOWED_TRANSITIONS[currentItem.status] || [];
      if (!allowed.includes(to)) {
        const err: any = new Error('INVALID_TRANSITION');
        err.statusCode = 409;
        err.payload = {
          error: 'INVALID_TRANSITION',
          message: `Invalid status transition from '${currentItem.status}' to '${to}'.`,
        };
        throw err;
      }

      // Permission check:
      // Approving (awaiting_approval -> resolved) or rejecting (awaiting_approval -> in_progress) requires approve permission (Lead/Admin)
      if (currentItem.status === 'awaiting_approval' && (to === 'resolved' || to === 'in_progress')) {
        if (!can(user, 'approve', currentItem)) {
          const err: any = new Error('FORBIDDEN');
          err.statusCode = 403;
          err.payload = {
            error: 'FORBIDDEN',
            message: 'Only Team Leads and Administrators can approve or reject work items.',
          };
          throw err;
        }
      } else {
        if (!can(user, 'transition', currentItem)) {
          const err: any = new Error('FORBIDDEN');
          err.statusCode = 403;
          err.payload = {
            error: 'FORBIDDEN',
            message: 'You do not have permission to transition this work item.',
          };
          throw err;
        }
      }

      // 3. Keep the version check and the 409 response
      const updateResult = await client.query<WorkItem>(
        `UPDATE work_items 
         SET status = $1, 
             version = version + 1, 
             updated_at = NOW() 
         WHERE id = $2 AND version = $3 
         RETURNING *;`,
        [to, id, version]
      );

      if (updateResult.rowCount === 0) {
        const err: any = new Error('OPTIMISTIC_LOCK_CONFLICT');
        err.statusCode = 409;
        err.payload = {
          error: 'OPTIMISTIC_LOCK_CONFLICT',
          message: 'This item was changed by someone else. Reload.',
          item: currentItem,
          current_version: currentItem.version,
        };
        throw err;
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
            team_id: currentItem.team_id,
            actor: user.name,
            from: currentItem.status,
            to,
          }),
        ]
      );

      return updateResult.rows[0];
    });

    res.json({
      message: 'Status transitioned successfully',
      item: updatedItem,
    });
  } catch (err: any) {
    if (err.statusCode && err.payload) {
      res.status(err.statusCode).json(err.payload);
      return;
    }
    throw err;
  }
}

/**
 * POST /api/items/:id/resolve
 * Legacy resolve route forwards to transition to resolved, ensuring member resolve shortcut is removed.
 */
export async function resolveItem(req: Request, res: Response): Promise<void> {
  req.body.to = 'resolved';
  req.body.version = typeof req.body.version === 'number' ? req.body.version : req.body.expected_version;
  return transitionItem(req, res);
}

/**
 * DELETE /api/items/:id
 * Delete a work item. Only Leads and Admins can delete.
 */
export async function deleteItem(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { id } = req.params;

  const currentResult = await pool.query<WorkItem>(
    'SELECT * FROM work_items WHERE id = $1',
    [id]
  );

  if (currentResult.rowCount === 0) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
    return;
  }

  const currentItem = currentResult.rows[0];

  // Task 2: Users outside an item's team get 404
  if (!can(user, 'delete', currentItem)) {
    const isMember = user.is_admin || user.memberships.some((m) => m.team_id === currentItem.team_id);
    if (!isMember) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Only Team Leads and Administrators can delete work items.',
    });
    return;
  }

  await withTransaction(async (client) => {
    await client.query('DELETE FROM work_items WHERE id = $1;', [id]);
  });

  res.json({ message: 'Work item deleted successfully', id });
}
