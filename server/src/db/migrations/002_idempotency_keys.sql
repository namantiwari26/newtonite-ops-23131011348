-- Migration 002: Add request_hash and ensure unique constraint on (user_id, key)
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);
ALTER TABLE idempotency_keys ALTER COLUMN status_code DROP NOT NULL;
ALTER TABLE idempotency_keys ALTER COLUMN response_body DROP NOT NULL;
ALTER TABLE idempotency_keys ALTER COLUMN endpoint DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_pkey'
  ) THEN
    ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_pkey;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_idempotency_user_key'
  ) THEN
    ALTER TABLE idempotency_keys ADD CONSTRAINT uq_idempotency_user_key UNIQUE (user_id, key);
  END IF;
END $$;
