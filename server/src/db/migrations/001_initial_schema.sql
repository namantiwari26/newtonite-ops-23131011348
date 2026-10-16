-- Workdesk Database Schema
-- Migration 001: Initial Workdesk Schema

-- 1. Users table (Task 2: is_admin boolean, no global role column)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Teams table
CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Team memberships (Roles live only in memberships: viewer, member, lead)
CREATE TABLE IF NOT EXISTS team_memberships (
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- viewer, member, lead
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- 4. Work items table (Task 4: single work_items table)
CREATE TABLE IF NOT EXISTS work_items (
  id VARCHAR(50) PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type VARCHAR(50) NOT NULL DEFAULT 'task',
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, in_progress, blocked, resolved, closed
  priority VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  assignee_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Task 5: Required Indexes on work_items
CREATE INDEX IF NOT EXISTS idx_work_items_team_status_priority ON work_items (team_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee ON work_items (assignee_id);
CREATE INDEX IF NOT EXISTS idx_work_items_updated_at ON work_items (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_cursor ON work_items (team_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_search_gin ON work_items USING gin(to_tsvector('english', title || ' ' || description));

-- 5. Activity events table
CREATE TABLE IF NOT EXISTS activity_events (
  id VARCHAR(50) PRIMARY KEY,
  item_id VARCHAR(50) NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  actor_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(50) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_item ON activity_events (item_id, created_at DESC);

-- 6. Comments table
CREATE TABLE IF NOT EXISTS comments (
  id VARCHAR(50) PRIMARY KEY,
  item_id VARCHAR(50) NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_item ON comments (item_id, created_at ASC);

-- 7. Idempotency keys table
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) NOT NULL,
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint VARCHAR(255),
  request_hash VARCHAR(64) NOT NULL,
  status_code INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_idempotency_user_key UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys (created_at);

-- 8. Transactional Outbox table
CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(50) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events (status, next_run_at) WHERE status IN ('pending', 'failed');
