import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.js';

/**
 * Idempotency enforcement middleware for POST requests.
 * 
 * Prevents accidental double-submissions (e.g. network retries, rapid duplicate clicks).
 * If an identical key was already successfully processed, the cached response
 * is immediately returned without re-executing business logic.
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
      message: 'Idempotency-Key header is required for this operation to prevent duplicate execution.',
    });
    return;
  }

  const userId = req.user?.id || 'anonymous';
  const endpoint = req.originalUrl || req.baseUrl;

  try {
    // 2. Check if this key was already processed for this user and endpoint
    const existing = await pool.query<{
      status_code: number;
      response_body: any;
    }>(
      `SELECT status_code, response_body 
       FROM idempotency_keys 
       WHERE key = $1 AND user_id = $2 AND endpoint = $3`,
      [idempotencyKey.trim(), userId, endpoint]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const record = existing.rows[0];
      res.setHeader('X-Cache-Lookup', 'HIT');
      res.setHeader('X-Idempotent-Replay', 'true');
      res.status(record.status_code).json(record.response_body);
      return;
    }

    // 3. Intercept `res.json` to capture and record the response upon success
    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        pool.query(
          `INSERT INTO idempotency_keys (key, user_id, endpoint, status_code, response_body)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (key) DO NOTHING`,
          [idempotencyKey.trim(), userId, endpoint, res.statusCode, JSON.stringify(body)]
        ).catch((err) => {
          console.error('[Idempotency Store Error]:', err);
        });
      }

      return originalJson(body);
    };

    next();
  } catch (err: any) {
    console.error('[Idempotency Middleware Error]:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to evaluate idempotency key',
    });
  }
}
