# Workdesk

Workdesk is an enterprise work-item tracking system designed for engineering and business teams.

## Demo Accounts & Authentication

All demo accounts share the standard password:

```
Demo@12345
```

The demo users pre-seeded into the database:

| Name | Email | Role | Teams |
| :--- | :--- | :--- | :--- |
| Priya Sharma | `priya.sharma@workdesk.test` | System Administrator (`is_admin: true`) | Billing & Payments (Lead), Core Platform (Lead), Customer Operations (Lead) |
| Marcus Chen | `marcus.chen@workdesk.test` | Team Member (`is_admin: false`) | Billing & Payments (Lead), Core Platform (Member) |
| Sarah Jenkins | `sarah.jenkins@workdesk.test` | Team Member (`is_admin: false`) | Billing & Payments (Member), Customer Operations (Member) |
| Elena Rostova | `elena.rostova@workdesk.test` | Team Member (`is_admin: false`) | Core Platform (Lead) |
| David Morales | `david.morales@workdesk.test` | Team Member (`is_admin: false`) | Customer Operations (Viewer) |

### Authentication Architecture
- Authentication uses `POST /api/auth/login` with email and password.
- Password verification is performed using `bcrypt.compare` against `password_hash`.
- Any failure returns `401 Unauthorized` with a generic message: `{"error": "INVALID_CREDENTIALS", "message": "Invalid email or password"}`.
- Successful login issues an `HS256` JWT with an 8-hour expiry containing only `sub` (the user ID).
- `JWT_SECRET` must be provided in the environment. The server refuses to start without it (no fallback default).

## Authorization Matrix

Authorization is centralized in a single `can(user, action, item)` function:

| Action | Viewer | Member | Lead | Administrator |
| :--- | :---: | :---: | :---: | :---: |
| `view` | Yes | Yes | Yes | Yes |
| `comment` | Yes | Yes | Yes | Yes |
| `create` | No | Yes | Yes | Yes |
| `update` | No | Yes | Yes | Yes |
| `claim` | No | Yes | Yes | Yes |
| `resolve` | No | Yes | Yes | Yes |
| `delete` | No | No | Yes | Yes |

*Note: Users who are not members of an item's team receive a `404 Not Found` response.*

## Architecture & Features

1. **Single Table Architecture**: All work items are stored in the `work_items` table.
2. **Optimistic Locking**: Every mutation requires `expected_version`, preventing race conditions with `409 Conflict`.
3. **Transactional Integrity**: Mutations and their corresponding `activity_events` are committed within a single database transaction.
4. **Claim Protocol**: Claim uses atomic `UPDATE ... WHERE assignee_id IS NULL AND version = $version`.
5. **Idempotency**: Item creation supports the `Idempotency-Key` header with cached responses in `idempotency_keys`.
6. **Keyset Cursor Pagination**: Lists use server-side filters and `(created_at, id)` keyset pagination for fast traversal across 5,000+ items.
7. **Transactional Outbox Worker**: Asynchronous events are saved to `outbox_events` and processed by a background worker with retry logic.

## Docker Setup

### Containers
- `workdesk-db`: PostgreSQL 16 database running on port `5432` (database: `workdesk`, user: `workdesk`).
- `workdesk-api`: Node.js Express API running on port `4000`.
- `workdesk-web`: React Vite frontend running on port `3000`.

### Running Locally
```powershell
docker compose down -v ; docker compose up --build
```
