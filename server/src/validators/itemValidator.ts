import { z } from 'zod';
import { WORK_ITEM_STATUSES } from '../types.js';

export const createItemSchema = z.object({
  team_id: z.string({ required_error: 'team_id is required' }).trim().min(1, 'team_id is required'),
  title: z
    .string({ required_error: 'title is required' })
    .trim()
    .min(1, 'title must be at least 1 character')
    .max(200, 'title cannot exceed 200 characters'),
  description: z
    .string()
    .max(5000, 'description cannot exceed 5000 characters')
    .optional()
    .nullable(),
  type: z
    .enum(['task', 'bug', 'feature', 'incident'] as const)
    .optional()
    .default('task'),
  priority: z
    .enum(['low', 'medium', 'high', 'critical'] as const)
    .optional()
    .default('medium'),
  due_date: z.string().nullable().optional(),
});

export const updateItemSchema = z.object({
  version: z.number({ required_error: 'version is required for optimistic locking' }),
  title: z
    .string()
    .trim()
    .min(1, 'title must be at least 1 character')
    .max(200, 'title cannot exceed 200 characters')
    .optional(),
  description: z
    .string()
    .max(5000, 'description cannot exceed 5000 characters')
    .optional()
    .nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical'] as const).optional(),
  status: z.enum(WORK_ITEM_STATUSES).optional(),
  assignee_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const addCommentSchema = z.object({
  content: z
    .string({ required_error: 'content is required' })
    .trim()
    .min(1, 'comment must be at least 1 character')
    .max(2000, 'comment cannot exceed 2000 characters'),
});

export const transitionItemSchema = z.object({
  to: z.enum(WORK_ITEM_STATUSES, { required_error: 'to status is required' }),
  version: z.number({ required_error: 'version is required for optimistic locking' }),
});

export const claimItemSchema = z.object({
  version: z.number({ required_error: 'version is required for optimistic locking' }),
});

export function formatZodError(error: z.ZodError): {
  error: string;
  message: string;
  fields: string[];
} {
  const fields = Array.from(new Set(error.errors.map((e) => e.path.join('.') || 'body')));
  const message = error.errors
    .map((e) => `${e.path.join('.') || 'field'}: ${e.message}`)
    .join('; ');
  return {
    error: 'VALIDATION_ERROR',
    message: `Validation failed for ${fields.join(', ')}: ${message}`,
    fields,
  };
}
