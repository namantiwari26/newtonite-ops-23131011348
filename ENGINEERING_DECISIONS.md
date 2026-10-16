# Workdesk - Engineering Decisions

This document outlines the key architectural and engineering decisions made during the design and implementation of Workdesk, an enterprise work-item management platform.

---

## 1. Concurrency Control: Optimistic Locking, Conditional Claims, and `SELECT FOR UPDATE` in Transitions

### Context
Workdesk is designed for operations environments where multiple operators concurrently view, claim, edit, and advance the lifecycle of work items. Under high concurrency, without strict locking, operations suffer from lost updates (last-write-wins), race conditions on claims, and invalid lifecycle transitions.

### Options Considered
1. **Pessimistic Locking Everywhere:** Acquire `SELECT ... FOR UPDATE` on every read and mutation.
2. **Pure Optimistic Locking:** Include a `version` column and run `UPDATE ... WHERE id = $1 AND version = $2` for all mutations.
3. **Hybrid Model:** Optimistic locking for standard updates, atomic conditional statements for claims, and targeted row-level locking (`SELECT ... FOR UPDATE`) inside transition transactions.

### Choice
We chose the **Hybrid Model**:
- **Optimistic Locking:** Every work item has an integer `version` column. Standard attribute updates increment `version = version + 1` and require `expected_version` in the payload. If 0 rows are updated, the server rolls back and returns `409 OPTIMISTIC_LOCK_CONFLICT` alongside the fresh DB row so the client can resolve the conflict.
- **Conditional-UPDATE Claim:** Claims execute `UPDATE work_items SET assignee_id = $1, status = 'in_progress', version = version + 1 WHERE id = $2 AND assignee_id IS NULL AND version = $3`. This guarantees that if two agents click claim simultaneously, exactly one succeeds and the other receives a `409` conflict.
- **`SELECT FOR UPDATE` for Status Transitions:** The `transitionItem` endpoint moves the item read inside the transaction with `SELECT * FROM work_items WHERE id = $1 FOR UPDATE`. The allowed-transition map and role permission checks (`can(user, 'approve' | 'transition', item)`) are evaluated on that locked row. The version check is evaluated atomically in the same transaction.

### Trade-off
Targeted row locking introduces a brief wait in PostgreSQL when two requests target the same item simultaneously. However, this eliminates race conditions and guarantees that status transitions adhere strictly to the allowed state graph and role permissions.

---

## 2. Transactional Outbox Pattern and Atomic Activity Events

### Context
Every work item change requires an audit trail (`activity_events`) and asynchronous downstream effects (notifications, external dispatches, search indexing). Direct synchronous calls to external message brokers or notification services within the HTTP request cycle produce dual-write failure modes (e.g., database commits but notification fails, or notification succeeds but database transaction rolls back).

### Options Considered
1. **Direct Notification Calls in Route Handlers:** Call notification logic immediately after the DB update.
2. **PostgreSQL CDC (Change Data Capture) or LISTEN/NOTIFY:** Use Debezium or logical replication streams.
3. **Transactional Outbox Table:** Write an `outbox_events` record inside the exact same database transaction (`withTransaction`) as the work item and activity event.

### Choice
We chose the **Transactional Outbox Table**:
- When an item is created, claimed, or transitioned, the item update, the `activity_events` audit row, and the `outbox_events` job are written in **ONE single database transaction**.
- An asynchronous worker processes pending events in batches using `SELECT ... FOR UPDATE SKIP LOCKED` to allow multiple concurrent workers without contention.
- Failed outbox jobs retry with exponential backoff and transition to `failed` upon reaching `max_attempts`.
- Successfully processed jobs are marked `completed`, ensuring deduplication if the batch processor re-examines the table.

### Trade-off
The outbox pattern guarantees **at-least-once delivery** rather than exactly-once delivery. Downstream consumers must handle idempotent processing. There is also a small latency between transaction commit and background worker execution (configured to 3 seconds by default).

---

## 3. Server-side Authorization via a Single `can(user, action, item)` Function

### Context
Workdesk enforces strict role boundaries: Team Leads, Team Members, Viewers, and System Administrators. Spreading authorization logic across multiple Express middleware functions, route handlers, and frontend components inevitably leads to privilege escalation, ID enumeration, and subtle policy drift.

### Options Considered
1. **Per-route Express Middleware (`isLead`, `isMember`, `isViewer`):** Separate route guards for each endpoint.
2. **External Policy Engine (CASL, OPA, Casbin):** Adding a separate policy layer with dynamic rule evaluation.
3. **Centralized Pure Function `can(user, action, item)`:** One authoritative function evaluated on the server.

### Choice
We chose a **Single Server-side `can(user, action, item)` Function**:
- Authorization lives exclusively on the server.
- Roles are strictly scoped to team memberships (`viewer`, `member`, `lead`) in `team_memberships`, plus a global `is_admin` boolean on `users`.
- **Tenant Boundary via 404:** Users who are not members of the item's team receive `404 NOT_FOUND` rather than `403 FORBIDDEN`. This completely prevents cross-team item ID enumeration and information leakage.
- **Permission Boundary via 403:** Authenticated users belonging to the team who lack permission for an action (e.g. viewers attempting mutations, members attempting to approve or reject items) receive `403 FORBIDDEN`.

### Trade-off
Requires fetching the user's team memberships upon authentication and injecting them into `req.user`. Every controller must pass the target item to `can()` before performing operations.

---

## 4. Idempotency Keys Scoped by `(user_id, key)` with Request Body Hashing

### Context
Network retries, gateway timeouts, and rapid double-submissions can cause accidental duplicate work item creation. Furthermore, a client could erroneously reuse an idempotency key with conflicting payloads.

### Options Considered
1. **Global Idempotency Key Primary Key without Payload Verification:** Key alone is primary key; returning previous response regardless of request body.
2. **In-Memory Cache (Redis):** Short-lived TTL for idempotency keys.
3. **Persistent Postgres Table with `(user_id, key)` Constraint and SHA-256 Request Hash:** Database-backed idempotency table storing canonical payload hash and response.

### Choice
We chose a **Persistent Postgres Table with `(user_id, key)` Constraint and Request Hash**:
- **Atomic Reservation:** Incoming POST requests attempt `INSERT INTO idempotency_keys (key, user_id, request_hash) VALUES (...) ON CONFLICT (user_id, key) DO NOTHING RETURNING *`.
- **Concurrency Safety:** If two requests arrive at the exact same millisecond with the same key, only one wins the atomic insert. The second request detects the existing key and awaits completion.
- **Payload Verification:** The request body is canonically serialized and hashed with SHA-256. If a client sends the same key with a different body, the server immediately returns `422 UNPROCESSABLE_ENTITY`.
- **Replay:** The same key with the same body immediately returns the cached status code and response payload with header `X-Idempotent-Replay: true`.

### Trade-off
Writing and querying `idempotency_keys` adds database operations to creation requests. In-flight requests poll briefly (40ms intervals) until the winner completes.

---

## 5. Keyset (Cursor) Pagination, Server-Side Filtering, and Polling over WebSockets

### Context
Enterprise issue trackers scale to tens of thousands of work items. Client-side filtering or SQL offset pagination (`OFFSET 15000`) degrades severely on large tables, as PostgreSQL must scan and discard thousands of rows.

### Options Considered
1. **Load All Items Client-Side:** Client queries the whole table and filters in memory.
2. **Offset-Based Pagination (`LIMIT / OFFSET`):** Standard page number pagination.
3. **Keyset Cursor Pagination with Composite Indexes and Polling:** Seek pagination based on indexed columns `(created_at, id)`.

### Choice
We chose **Keyset Cursor Pagination with Composite Indexes**:
- Queries use `WHERE (created_at, id) < (cursor_created_at, cursor_id) ORDER BY created_at DESC, id DESC LIMIT $N`.
- Supported by composite B-Tree indexes:
  - `idx_work_items_cursor (team_id, created_at DESC, id DESC)`
  - `idx_work_items_team_status_priority (team_id, status, priority)`
  - `idx_work_items_search_gin` for full-text search across title and description.
- **Polling over WebSockets:** The frontend leverages TanStack Query with background polling rather than WebSockets. This eliminates stateful socket connections, firewall disconnects, reconnection cascades, and complex server clustering.

### Trade-off
Keyset pagination cannot jump directly to an arbitrary page number (e.g. "jump to page 42"). It requires sequential forward/backward cursor traversal, which aligns with modern feed and list workflows.

---

## What I Chose Not to Build

1. **Stateful WebSocket Server:** Avoided socket servers in favor of stateless HTTP with TanStack Query cache invalidation and polling, keeping horizontal scaling simple.
2. **Distributed Redis Cache Layer:** Kept PostgreSQL as the single source of truth for all data, locks, and idempotency states, preventing cache invalidation bugs and split-brain scenarios.
3. **Heavy ORM (Prisma/TypeORM):** Utilized plain SQL migrations and the native `pg` driver to maintain total control over query performance, transaction boundaries (`withTransaction`), and concurrency locks (`FOR UPDATE`, `SKIP LOCKED`).
4. **Microservices Decomposition:** Kept the application as a clean modular monolith with colocated background worker to eliminate distributed transaction failures and network overhead.
5. **Full OAuth2 / OIDC Server:** Used standard HS256 JWTs with bcrypt password hashing and 8-hour expiry for straightforward auditing and zero external identity provider dependencies.
