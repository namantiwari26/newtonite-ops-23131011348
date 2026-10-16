import { pool, withTransaction } from '../db/pool.js';
import { OutboxEvent } from '../types.js';

/**
 * Transactional Outbox Worker
 * 
 * Handles reliable asynchronous processing with:
 * - Concurrency safety via `FOR UPDATE SKIP LOCKED`
 * - Exponential backoff on retries
 * - Permanent failure state when max_attempts is reached
 * - Detailed error recording
 */

/**
 * Executes the specific asynchronous handler for a given event.
 */
async function handleEvent(event: OutboxEvent): Promise<{ success: boolean; result?: any }> {
  console.log(`[Outbox Worker] Executing handler for event ${event.id} (${event.event_type})...`);

  switch (event.event_type) {
    case 'ITEM_CREATED_NOTIFICATION':
    case 'ITEM_CREATED_DISPATCH':
      console.log(`[Outbox Worker] Notifying team ${event.payload.team_id} for new work item: "${event.payload.title}"`);
      return { success: true, result: 'Notification dispatched' };

    case 'ITEM_CLAIMED_NOTIFICATION':
      console.log(`[Outbox Worker] User ${event.payload.claimed_by} claimed work item ${event.payload.item_id}`);
      return { success: true, result: 'Claim broadcasted' };

    case 'ITEM_UPDATED_SYNC':
      console.log(`[Outbox Worker] Synchronized updates for work item ${event.payload.item_id}`);
      return { success: true, result: 'Index updated' };

    case 'ITEM_RESOLVED_NOTIFICATION':
    case 'ITEM_RESOLVED_ARCHIVE':
      console.log(`[Outbox Worker] Work item ${event.payload.item_id} resolved and archived`);
      return { success: true, result: 'Resolution archived' };

    case 'ITEM_STATUS_TRANSITIONED':
      console.log(`[Outbox Worker] Work item ${event.payload.item_id} transitioned from ${event.payload.from} to ${event.payload.to}`);
      return { success: true, result: 'Transition processed' };

    case 'SIMULATED_FAILURE_TEST':
      throw new Error('Simulated external service timeout / 503 gateway error');

    default:
      console.log(`[Outbox Worker] Processed event: ${event.event_type}`);
      return { success: true, result: 'Default noop handler' };
  }
}

/**
 * Processes a single batch of pending or retryable outbox events.
 */
export async function processOutboxBatch(batchSize: number = 10): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  let succeeded = 0;
  let failed = 0;

  // 1. Fetch and lock candidates using `FOR UPDATE SKIP LOCKED` to allow multiple concurrent workers
  const candidates = await withTransaction(async (client) => {
    const { rows } = await client.query<OutboxEvent>(
      `SELECT * FROM outbox_events 
       WHERE status IN ('pending', 'failed') 
         AND attempts < max_attempts 
         AND next_run_at <= NOW() 
       ORDER BY created_at ASC 
       LIMIT $1 
       FOR UPDATE SKIP LOCKED;`,
      [batchSize]
    );

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await client.query(
        `UPDATE outbox_events 
         SET status = 'processing' 
         WHERE id = ANY($1);`,
        [ids]
      );
    }

    return rows;
  });

  if (candidates.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // 2. Process each event individually
  for (const event of candidates) {
    try {
      await handleEvent(event);

      await pool.query(
        `UPDATE outbox_events 
         SET status = 'completed', 
             attempts = attempts + 1, 
             processed_at = NOW(), 
             last_error = NULL 
         WHERE id = $1;`,
        [event.id]
      );
      succeeded++;
    } catch (err: any) {
      const newAttempts = event.attempts + 1;
      const isExhausted = newAttempts >= event.max_attempts;
      const errorMessage = err?.message || 'Unknown processing error';

      if (isExhausted) {
        console.error(`[Outbox Worker] Event ${event.id} permanently failed after ${newAttempts} attempts.`);
        await pool.query(
          `UPDATE outbox_events 
           SET status = 'failed', 
               attempts = $1, 
               last_error = $2, 
               processed_at = NOW() 
           WHERE id = $3;`,
          [newAttempts, errorMessage, event.id]
        );
      } else {
        const backoffSeconds = Math.pow(2, newAttempts) * 2;
        console.warn(`[Outbox Worker] Event ${event.id} failed attempt ${newAttempts}/${event.max_attempts}. Retrying in ${backoffSeconds}s...`);
        await pool.query(
          `UPDATE outbox_events 
           SET status = 'pending', 
               attempts = $1, 
               last_error = $2, 
               next_run_at = NOW() + ($3 || ' seconds')::interval 
           WHERE id = $4;`,
          [newAttempts, errorMessage, `${backoffSeconds} seconds`, event.id]
        );
      }
      failed++;
    }
  }

  return {
    processed: candidates.length,
    succeeded,
    failed,
  };
}

/**
 * Starts a recurring background worker polling loop.
 */
export function startOutboxWorker(intervalMs: number = 3000): { stop: () => void } {
  let isRunning = true;
  let timer: NodeJS.Timeout | null = null;

  async function loop() {
    if (!isRunning) return;
    try {
      await processOutboxBatch(10);
    } catch (err) {
      console.error('[Outbox Worker Loop Error]:', err);
    } finally {
      if (isRunning) {
        timer = setTimeout(loop, intervalMs);
      }
    }
  }

  timer = setTimeout(loop, 1000);

  return {
    stop: () => {
      isRunning = false;
      if (timer) clearTimeout(timer);
      console.log('[Outbox Worker] Worker stopped.');
    },
  };
}
