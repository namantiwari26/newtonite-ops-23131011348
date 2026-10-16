# Workdesk

Workdesk is an enterprise work-item tracking system designed for engineering and business teams.

## Demo Accounts & Authentication

All demo accounts share the standard password:

```
Demo@12345
```

The 10 pre-seeded enterprise users:

| Name | Email | System Role | Team Memberships |
| :--- | :--- | :--- | :--- |
| Alex Vance | `alex.vance@workdesk.test` | System Administrator (`is_admin: true`) | Full administrative access across all teams |
| Priya Sharma | `priya.sharma@workdesk.test` | User (`is_admin: false`) | Billing & Payments (**Lead**) |
| Marcus Chen | `marcus.chen@workdesk.test` | User (`is_admin: false`) | Billing & Payments (**Member**), Core Platform (**Member**) |
| Samira Khan | `samira.khan@workdesk.test` | User (`is_admin: false`) | Billing & Payments (**Viewer**) |
| Elena Rostova | `elena.rostova@workdesk.test` | User (`is_admin: false`) | Core Platform (**Lead**) |
| Lucas Silva | `lucas.silva@workdesk.test` | User (`is_admin: false`) | Core Platform (**Member**) |
| Nina Patel | `nina.patel@workdesk.test` | User (`is_admin: false`) | Core Platform (**Viewer**) |
| Rachel Green | `rachel.green@workdesk.test` | User (`is_admin: false`) | Customer Operations (**Lead**) |
| Sarah Jenkins | `sarah.jenkins@workdesk.test` | User (`is_admin: false`) | Customer Operations (**Member**) |
| David Morales | `david.morales@workdesk.test` | User (`is_admin: false`) | Customer Operations (**Viewer**) |

### Authentication Architecture
- Authentication uses `POST /api/auth/login` with email and password.
- Password verification is performed using `bcrypt.compare` against `password_hash`.
- Any failure returns `401 Unauthorized` with a generic message: `{"error": "INVALID_CREDENTIALS", "message": "Invalid email or password"}`.
- Successful login issues an `HS256` JWT with an 8-hour expiry containing only `sub` (the user ID).
- `JWT_SECRET` must be provided in the environment. The server refuses to start without it (no fallback default).

## Authorization Matrix

Authorization is centralized in a single `can(user, action, item)` function:

| Action | Viewer | Member | Lead | Administrator (`is_admin: true`) | Outside Team |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `view` | Yes | Yes | Yes | Yes | **404** |
| `comment` | Yes | Yes | Yes | Yes | **404** |
| `create` | No (403) | Yes | Yes | Yes | **404** |
| `update` | No (403) | Yes | Yes | Yes | **404** |
| `claim` | No (403) | Yes | Yes | Yes | **404** |
| `transition` | No (403) | Yes (up to awaiting_approval) | Yes | Yes | **404** |
| `approve` | No (403) | No (403) | Yes | Yes | **404** |
| `delete` | No (403) | No (403) | Yes | Yes | **404** |

*Note: Users who are not members of an item's team receive a `404 Not Found` response on all item endpoints.*

## Workflow & Status Transitions

Work items follow an enforced state machine via `POST /api/items/:id/transition`:

```
[open] ───────► [in_progress] ───────► [awaiting_approval]
                     ▲                       │
                     │ (reject by lead)      │ (approve by lead)
                     ├───────────────────────┴───────► [resolved] ───► [closed]
                     │                                     │
                     └───────────── (reopen) ──────────────┘
```

Allowed transitions map:
- `open` → `in_progress`
- `in_progress` → `awaiting_approval`
- `awaiting_approval` → `resolved` (approve by lead/admin) or → `in_progress` (reject by lead/admin)
- `resolved` → `closed` or → `in_progress` (reopen)
- Any other transition returns `409 Conflict` (`INVALID_TRANSITION`).
- Any update with an outdated version returns `409 Conflict` (`OPTIMISTIC_LOCK_CONFLICT`) along with the latest item.

## Seed Configuration

The seed item count is configurable via the `SEED_ITEMS` environment variable:
- `SEED_ITEMS`: Number of work items to generate (default: `20000`).

## Architecture & Features

1. **Single Table Architecture**: All work items are stored in the `work_items` table.
2. **Optimistic Locking**: Every mutation requires `expected_version`, preventing race conditions with `409 Conflict`.
3. **Transactional Integrity**: Mutations, status transitions, and their corresponding `activity_events` and outbox jobs are committed within a single database transaction.
4. **Claim Protocol**: Claim uses atomic `UPDATE ... WHERE assignee_id IS NULL AND version = $version`.
5. **Idempotency**: Item creation supports the `Idempotency-Key` header with cached responses in `idempotency_keys`.
6. **Keyset Cursor Pagination**: Lists use server-side filters and `(created_at, id)` keyset pagination for fast traversal across 20,000+ items.
7. **Transactional Outbox Worker**: Asynchronous events are saved to `outbox_events` and processed by a background worker with retry logic and idempotency.

## Docker Setup

### Containers
- `workdesk-db`: PostgreSQL 16 database running on port `5432` (database: `workdesk`, user: `workdesk`).
- `workdesk-api`: Node.js Express API running on port `4000`.
- `workdesk-web`: React Vite frontend running on port `3000`.

### Running Locally
```powershell
docker compose down -v ; docker compose up --build
```
