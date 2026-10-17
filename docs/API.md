# Workdesk API Documentation

Workdesk provides an authenticated, role-scoped REST API for cross-functional task management, lifecycle transitions, comments, and audit histories.

---

## Authentication & Security

- **Authentication Scheme:** `Bearer <JWT>` in the `Authorization` HTTP header.
- **Token Format:** Signed `HS256` token with an 8-hour expiry containing the subject `sub` (User ID).
- **Security Headers:** All responses include standard OWASP-recommended HTTP headers via `helmet` (Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, etc.).
- **Rate Limiting:** `POST /api/auth/login` is rate-limited to 10 attempts per 15 minutes per IP address and email. Exceeding the threshold returns `429 TOO_MANY_REQUESTS`.
- **Tenant Isolation:** Users attempting to access work items belonging to teams they do not belong to receive `404 NOT_FOUND` rather than `403 FORBIDDEN` to prevent team ID enumeration and information disclosure.

---

## Error Response Format

All error responses adhere to a uniform JSON shape:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description of the error."
}
```

Common error codes:

- `VALIDATION_ERROR` (400): Request body, parameters, or query string failed validation.
- `UNAUTHORIZED` (401): Missing, expired, or invalid JWT token or credentials.
- `FORBIDDEN` (403): User lacks sufficient role permissions for the target action.
- `NOT_FOUND` (404): Resource not found or belongs to a team the user does not have access to.
- `OPTIMISTIC_LOCK_CONFLICT` (409): Resource version mismatch; item was modified concurrently.
- `INVALID_TRANSITION` (409): Target status transition is disallowed from the current status.
- `ALREADY_CLAIMED` (409): Work item is already assigned to another user.
- `UNPROCESSABLE_ENTITY` (422): Reused idempotency key with conflicting payload hash.
- `TOO_MANY_REQUESTS` (429): Rate limit exceeded.
- `INTERNAL_ERROR` (500): Unhandled internal server error.

---

## API Endpoints Summary

| Method   | Path                        | Required Role                                          | Request                                                                                          | Responses        | Error Codes                       |
| :------- | :-------------------------- | :----------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :--------------- | :-------------------------------- |
| `POST`   | `/api/auth/login`           | Public (Rate-limited)                                  | JSON `{ email, password }`                                                                       | `200 OK`         | `400`, `401`, `429`               |
| `GET`    | `/api/auth/me`              | Authenticated (Any role)                               | None                                                                                             | `200 OK`         | `401`                             |
| `GET`    | `/api/teams`                | Authenticated (Any role)                               | None                                                                                             | `200 OK`         | `401`                             |
| `GET`    | `/api/users`                | Authenticated (Any role)                               | None                                                                                             | `200 OK`         | `401`                             |
| `GET`    | `/api/items`                | Authenticated (Scoped)                                 | Query params: `team_id`, `status`, `priority`, `assignee`, `search`, `cursor`, `limit`           | `200 OK`         | `400`, `401`                      |
| `POST`   | `/api/items`                | Team Member / Lead / Admin                             | Header: `Idempotency-Key`<br>JSON `{ team_id, title, description?, priority, type?, due_date? }` | `201 Created`    | `400`, `401`, `403`, `404`, `422` |
| `GET`    | `/api/items/:id`            | Team Viewer / Member / Lead / Admin                    | None                                                                                             | `200 OK`         | `401`, `404`                      |
| `PATCH`  | `/api/items/:id`            | Team Member / Lead / Admin                             | JSON `{ version, title?, description?, priority?, status?, due_date?, assignee_id? }`            | `200 OK`         | `400`, `401`, `403`, `404`, `409` |
| `POST`   | `/api/items/:id/claim`      | Team Member / Lead / Admin                             | JSON `{ version }`                                                                               | `200 OK`         | `400`, `401`, `403`, `404`, `409` |
| `POST`   | `/api/items/:id/transition` | Member / Lead / Admin _(Approval requires Lead/Admin)_ | JSON `{ to, version }`                                                                           | `200 OK`         | `400`, `401`, `403`, `404`, `409` |
| `POST`   | `/api/items/:id/comments`   | Team Viewer / Member / Lead / Admin                    | JSON `{ content }`                                                                               | `201 Created`    | `400`, `401`, `403`, `404`        |
| `DELETE` | `/api/items/:id`            | Team Lead / Admin                                      | None                                                                                             | `204 No Content` | `401`, `403`, `404`               |

---

## Detailed Endpoint Reference

### 1. `POST /api/auth/login`

Authenticates user credentials and returns an HS256 JWT.

- **Request Body:**
  ```json
  {
    "email": "priya.sharma@workdesk.test",
    "password": "Demo@12345"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "usr_priya",
      "email": "priya.sharma@workdesk.test",
      "name": "Priya Sharma",
      "is_admin": false,
      "memberships": [{ "team_id": "team_billing", "role": "lead" }]
    }
  }
  ```
- **Error Codes:** `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_REQUESTS`.

---

### 2. `GET /api/auth/me`

Fetches the currently authenticated user's profile and active team memberships.

- **Headers:** `Authorization: Bearer <token>`
- **Response (`200 OK`):**
  ```json
  {
    "user": {
      "id": "usr_priya",
      "email": "priya.sharma@workdesk.test",
      "name": "Priya Sharma",
      "is_admin": false,
      "memberships": [{ "team_id": "team_billing", "role": "lead" }]
    }
  }
  ```
- **Error Codes:** `401 UNAUTHORIZED`.

---

### 3. `GET /api/teams`

Lists all teams available to the user.

- **Response (`200 OK`):**
  ```json
  {
    "teams": [
      {
        "id": "team_billing",
        "name": "Billing & Payments",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```
- **Error Codes:** `401 UNAUTHORIZED`.

---

### 4. `GET /api/users`

Lists all users with public profile data and team memberships.

- **Response (`200 OK`):**
  ```json
  {
    "users": [
      {
        "id": "usr_priya",
        "name": "Priya Sharma",
        "email": "priya.sharma@workdesk.test",
        "is_admin": false,
        "memberships": [{ "team_id": "team_billing", "role": "lead" }]
      }
    ]
  }
  ```
- **Error Codes:** `401 UNAUTHORIZED`.

---

### 5. `GET /api/items`

Queries work items using server-side filtering and keyset cursor pagination. Regular users only receive items from teams they belong to; administrators can query across all teams.

- **Query Parameters:**
  - `team_id` (optional): Filter by team UUID.
  - `status` (optional): `open`, `in_progress`, `awaiting_approval`, `resolved`, `closed`.
  - `priority` (optional): `critical`, `high`, `medium`, `low`.
  - `assignee` (optional): User ID, or `unassigned`.
  - `search` (optional): Full-text search string.
  - `cursor` (optional): Base64-encoded cursor token `(created_at, id)` for next page.
  - `limit` (optional): Items per page (default: `50`, maximum: `100`).
- **Response (`200 OK`):**
  ```json
  {
    "items": [
      {
        "id": "wi_82f1b4",
        "team_id": "team_billing",
        "title": "Payment gateway timeout on ACH transfers",
        "description": "ACH settlements are experiencing intermittent 504 gateway timeouts.",
        "status": "open",
        "priority": "critical",
        "type": "bug",
        "assignee_id": null,
        "assignee_name": null,
        "created_by": "usr_marcus",
        "creator_name": "Marcus Chen",
        "version": 1,
        "due_date": "2026-10-25T18:00:00.000Z",
        "created_at": "2026-10-18T00:00:00.000Z",
        "updated_at": "2026-10-18T00:00:00.000Z"
      }
    ],
    "total_count": 142,
    "has_more": true,
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0xMC0xOCIsImlkIjoid2lfODJmMWI0In0="
  }
  ```
- **Error Codes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`.

---

### 6. `POST /api/items`

Creates a new work item. Must include an `Idempotency-Key` header.

- **Headers:**
  - `Authorization: Bearer <token>`
  - `Idempotency-Key: <UUID>`
- **Request Body:**
  ```json
  {
    "team_id": "team_billing",
    "title": "Stripe webhook signature validation error",
    "description": "Signatures failing verification on invoice.payment_succeeded events.",
    "priority": "high",
    "type": "bug",
    "due_date": "2026-10-28T00:00:00.000Z"
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "item": {
      "id": "wi_99a1b2",
      "team_id": "team_billing",
      "title": "Stripe webhook signature validation error",
      "status": "open",
      "priority": "high",
      "version": 1,
      "created_at": "2026-10-18T00:15:00.000Z"
    }
  }
  ```
- **Replay Behavior:** Resending the exact same `Idempotency-Key` with the identical body returns the cached `201 Created` response with header `X-Idempotent-Replay: true`.
- **Error Codes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `422 UNPROCESSABLE_ENTITY`.

---

### 7. `GET /api/items/:id`

Retrieves full details for a single work item, including historical activity events and comments.

- **Response (`200 OK`):**
  ```json
  {
    "item": {
      "id": "wi_82f1b4",
      "title": "Payment gateway timeout on ACH transfers",
      "version": 3,
      "status": "in_progress"
    },
    "comments": [
      {
        "id": "cm_01a",
        "item_id": "wi_82f1b4",
        "user_id": "usr_priya",
        "user_name": "Priya Sharma",
        "content": "Investigating routing table latency.",
        "created_at": "2026-10-18T00:20:00.000Z"
      }
    ],
    "activity_events": [
      {
        "id": "act_01",
        "item_id": "wi_82f1b4",
        "actor_id": "usr_marcus",
        "actor_name": "Marcus Chen",
        "action": "created",
        "details": {},
        "created_at": "2026-10-18T00:00:00.000Z"
      }
    ]
  }
  ```
- **Error Codes:** `401 UNAUTHORIZED`, `404 NOT_FOUND`.

---

### 8. `PATCH /api/items/:id`

Updates work item fields with optimistic concurrency locking (`version`).

- **Request Body:**
  ```json
  {
    "version": 1,
    "title": "Updated title",
    "priority": "critical",
    "description": "Additional incident context."
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "item": {
      "id": "wi_82f1b4",
      "title": "Updated title",
      "priority": "critical",
      "version": 2
    }
  }
  ```
- **Error Codes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 OPTIMISTIC_LOCK_CONFLICT`.

---

### 9. `POST /api/items/:id/claim`

Atomically assigns an unassigned work item to the authenticated user and transitions status to `in_progress`.

- **Request Body:**
  ```json
  {
    "version": 1
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "item": {
      "id": "wi_82f1b4",
      "assignee_id": "usr_priya",
      "status": "in_progress",
      "version": 2
    }
  }
  ```
- **Error Codes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 ALREADY_CLAIMED` / `OPTIMISTIC_LOCK_CONFLICT`.

---

### 10. `POST /api/items/:id/transition`

Advances or reverts a work item's status according to the lifecycle state machine.

- **Request Body:**
  ```json
  {
    "to": "awaiting_approval",
    "version": 2
  }
  ```
- **Allowed Transitions:**
  - `open` → `in_progress`
  - `in_progress` → `awaiting_approval`
  - `awaiting_approval` → `resolved` (Requires Team Lead or Admin)
  - `awaiting_approval` → `in_progress` (Requires Team Lead or Admin)
  - `resolved` → `closed` (Requires Team Lead or Admin)
  - `resolved` → `in_progress` (Requires Team Lead or Admin)
- **Response (`200 OK`):**
  ```json
  {
    "item": {
      "id": "wi_82f1b4",
      "status": "awaiting_approval",
      "version": 3
    }
  }
  ```
- **Error Codes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 INVALID_TRANSITION` / `OPTIMISTIC_LOCK_CONFLICT`.

---

### 11. `POST /api/items/:id/comments`

Adds a discussion comment to a work item and writes an atomic `activity_events` entry in the same transaction.

- **Request Body:**
  ```json
  {
    "content": "Root cause identified in downstream payment aggregator."
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "comment": {
      "id": "cm_481a",
      "item_id": "wi_82f1b4",
      "user_id": "usr_priya",
      "content": "Root cause identified in downstream payment aggregator.",
      "created_at": "2026-10-18T00:30:00.000Z"
    }
  }
  ```
- **Error Codes:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`.

---

### 12. `DELETE /api/items/:id`

Deletes a work item and its associated comments and activity history.

- **Permissions:** Restricted strictly to Team Leads and Administrators.
- **Response (`204 No Content`)**
- **Error Codes:** `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`.
