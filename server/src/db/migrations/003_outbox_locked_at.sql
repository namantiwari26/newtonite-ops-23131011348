-- Migration 003: Add locked_at column to outbox_events for stale processing job recovery
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Add partial index for fast lookup of stale processing jobs
CREATE INDEX IF NOT EXISTS idx_outbox_processing_locked 
ON outbox_events (status, locked_at) 
WHERE status = 'processing';
