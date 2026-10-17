import { Request, Response, NextFunction } from 'express';
import { can } from '../auth/can.js';
import { AppError } from '../errors.js';
import * as itemService from '../services/itemService.js';
import {
  createItemSchema,
  updateItemSchema,
  addCommentSchema,
  transitionItemSchema,
  claimItemSchema,
  formatZodError,
} from '../validators/itemValidator.js';

/**
 * GET /api/items
 * Keyset cursor pagination with filters. Default limit 50, maximum 100.
 */
export async function listItems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const teamId = (req.query.team_id as string) || '';
    const status = (req.query.status as string) || '';
    const priority = (req.query.priority as string) || '';
    const assignee = (req.query.assignee as string) || '';
    const search = (req.query.search as string) || '';
    const cursorStr = (req.query.cursor as string) || '';

    // Cap limit at 100, default 50
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);

    let cursor = null;
    if (cursorStr) {
      cursor = itemService.decodeCursor(cursorStr);
      if (!cursor) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid cursor encoding or payload structure.',
          fields: ['cursor'],
        });
        return;
      }
    }

    const result = await itemService.listItems(
      { team_id: teamId, status, priority, assignee, search },
      limit,
      cursor,
      user
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/items/:id
 * Fetches item detail, activity audit events, and comments.
 */
export async function getItemById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    const raw = await itemService.getRawItem(id);
    if (!raw) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    if (!can(user, 'view', raw)) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    const detail = await itemService.getItemDetail(id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/items
 * Creates a work item within a team.
 */
export async function createItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;

    const parsed = createItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(formatZodError(parsed.error));
      return;
    }

    const { team_id, title, description, type, priority, due_date } = parsed.data;

    // Verify team exists
    const teamExists = await itemService.checkTeamExists(team_id);
    if (!teamExists) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Team '${team_id}' does not exist.`,
        fields: ['team_id'],
      });
      return;
    }

    if (!can(user, 'create', { team_id })) {
      const isMember = user.is_admin || user.memberships.some((m) => m.team_id === team_id);
      if (!isMember) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Team not found' });
        return;
      }
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Permission denied to create work items in this team',
      });
      return;
    }

    const item = await itemService.createItem(
      { team_id, title, description, type, priority, due_date },
      user
    );

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/items/:id/claim
 * Claims an unassigned work item. Requires version.
 */
export async function claimItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    const parsed = claimItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(formatZodError(parsed.error));
      return;
    }

    const raw = await itemService.getRawItem(id);
    if (!raw) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    if (!can(user, 'claim', raw)) {
      const isMember = user.is_admin || user.memberships.some((m) => m.team_id === raw.team_id);
      if (!isMember) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
        return;
      }
      res.status(403).json({ error: 'FORBIDDEN', message: 'Viewers cannot claim work items.' });
      return;
    }

    if (raw.assignee_id !== null) {
      res.status(409).json({
        error: 'ALREADY_CLAIMED',
        message: `Item has already been claimed by user '${raw.assignee_id}'.`,
        current_assignee: raw.assignee_id,
      });
      return;
    }

    const item = await itemService.claimItem(id, parsed.data.version, user);
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/items/:id
 * Updates item fields with optimistic concurrency version check.
 */
export async function updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    const parsed = updateItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(formatZodError(parsed.error));
      return;
    }

    const raw = await itemService.getRawItem(id);
    if (!raw) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    if (!can(user, 'update', raw)) {
      const isMember = user.is_admin || user.memberships.some((m) => m.team_id === raw.team_id);
      if (!isMember) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
        return;
      }
      res.status(403).json({ error: 'FORBIDDEN', message: 'Viewers cannot update work items.' });
      return;
    }

    const item = await itemService.updateItem(id, parsed.data.version, parsed.data, user);
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/items/:id/comments
 * Adds comment and audit event in same transaction.
 */
export async function addComment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    const parsed = addCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(formatZodError(parsed.error));
      return;
    }

    const raw = await itemService.getRawItem(id);
    if (!raw) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    if (!can(user, 'comment', raw)) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    const comment = await itemService.addComment(id, parsed.data.content, user);
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/items/:id/transition
 * Transitions item status with row-level locking and permission validation.
 */
export async function transitionItem(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    const parsed = transitionItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(formatZodError(parsed.error));
      return;
    }

    const item = await itemService.transitionItem(id, parsed.data.to, parsed.data.version, user);
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/items/:id
 * Deletes work item. Requires lead or admin permissions.
 */
export async function deleteItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    const raw = await itemService.getRawItem(id);
    if (!raw) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
      return;
    }

    if (!can(user, 'delete', raw)) {
      const isMember = user.is_admin || user.memberships.some((m) => m.team_id === raw.team_id);
      if (!isMember) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Work item not found' });
        return;
      }
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only team leads and administrators can delete work items.',
      });
      return;
    }

    await itemService.deleteItem(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
