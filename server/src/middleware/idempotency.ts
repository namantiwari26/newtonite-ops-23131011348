import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.js';

/**
 * Deterministically stringifies an object by sorting keys, ensuring stable hashing.
 */
function canonicalStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Computes a SHA-256 hash of the canonical request body.
 */
export function hashRequestBody(body: any): string {
  const normalized = canonicalStringify(body);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Idempotency enforcement middleware for POST requests.
 *
 * - Rejects requests without Idempotency-Key (400)
 * - Stores key, user_id, request_hash, status_code, and response_body
 * - Same key + same body -> returns stored response
 * - Same key + different body -> returns 422
 * - Concurrent requests with same key -> unique constraint on (user_id, key)
 *   ensures only one item is created; concurrent requests await the stored response.
 */
export async function requireIdempotency(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  // 1. Reject if Idempotency-Key header is missing
  if (!idempotencyKey || !idempotencyKey.trim()) {
    res.status(400).json({
      error: 'MISSING_IDEMPOTENCY_KEY',
      message:
        'Idempotency-Key header is required for this operation to prevent duplicate execution.',
    });
    return;
  }

  const trimmedKey = idempotencyKey.trim();
  const userId = req.user?.id || 'anonymous';
  const endpoint = req.originalUrl || req.baseUrl || '/api/items';
  const requestHash = hashRequestBody(req.body);

  try {
    // 2. Atomic attempt to claim (user_id, key) using unique constraint and INSERT ... ON CONFLICT
    const insertResult = await pool.query(
      `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, $4, NULL, NULL)
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING *;`,
      [trimmedKey, userId, endpoint, requestHash]
    );

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      // WINNER: This request won the claim for (user_id, key) and proceeds to execute
      const originalJson = res.json.bind(res);
      res.json = (body: any): Response => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          pool
            .query(
              `UPDATE idempotency_keys 
             SET status_code = $1, response_body = $2 
             WHERE user_id = $3 AND key = $4`,
              [res.statusCode, JSON.stringify(body), userId, trimmedKey]
            )
            .catch((err) => {
              console.error('[Idempotency Store Error]:', err);
            });
        } else {
          // If request failed with error code, clean up pending reservation so it can be retried
          pool
            .query(
              `DELETE FROM idempotency_keys 
             WHERE user_id = $1 AND key = $2 AND status_code IS NULL`,
              [userId, trimmedKey]
            )
            .catch(() => {});
        }
        return originalJson(body);
      };

      next();
      return;
    }

    // CONFLICT: Key already exists. Check stored record.
    const existingResult = await pool.query<{
      request_hash: string;
      status_code: number | null;
      response_body: any;
    }>(
      `SELECT request_hash, status_code, response_body 
       FROM idempotency_keys 
       WHERE user_id = $1 AND key = $2;`,
      [userId, trimmedKey]
    );

    if (existingResult.rowCount === 0) {
      // Rare edge case: the conflicting row was deleted due to an error; proceed as fresh
      return requireIdempotency(req, res, next);
    }

    const existing = existingResult.rows[0];

    // Check if request body differs: return 422
    if (existing.request_hash !== requestHash) {
      res.status(422).json({
        error: 'UNPROCESSABLE_ENTITY',
        message: 'Idempotency key has already been used with a different request payload.',
      });
      return;
    }

    // If completed: return cached response
    if (existing.status_code !== null) {
      res.setHeader('X-Cache-Lookup', 'HIT');
      res.setHeader('X-Idempotent-Replay', 'true');
      res.status(existing.status_code).json(existing.response_body);
      return;
    }

    // Concurrent in-flight request with same key & body: poll until completed
    const maxWaitMs = 5000;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 40));
      const checkResult = await pool.query<{
        status_code: number | null;
        response_body: any;
      }>(
        `SELECT status_code, response_body 
         FROM idempotency_keys 
         WHERE user_id = $1 AND key = $2;`,
        [userId, trimmedKey]
      );
      if (checkResult.rows.length > 0 && checkResult.rows[0].status_code !== null) {
        res.setHeader('X-Cache-Lookup', 'HIT');
        res.setHeader('X-Idempotent-Replay', 'true');
        res.status(checkResult.rows[0].status_code).json(checkResult.rows[0].response_body);
        return;
      }
    }

    res.status(409).json({
      error: 'CONCURRENT_REQUEST',
      message: 'A request with this idempotency key is currently processing.',
    });
  } catch (err: any) {
    console.error('[Idempotency Middleware Error]:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to evaluate idempotency key',
    });
  }
}
