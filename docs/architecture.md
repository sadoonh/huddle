# Architecture

## 1. Context

The application is an internal tool for a small analytics team. It must feel like part of the **nex** portal (shared SSO, shared hosting), not a separate product with its own login. The workload is low-volume, read-heavy during a 15–30 minute standup, with short write bursts. The primary experience is the Live Standup Workspace.

Constraints from the brief:

- React + Tailwind frontend, Python + FastAPI backend.
- PostgreSQL as the system of record.
- Serverless compute on existing AWS infrastructure, Terraform, GitHub Actions.
- Reuse nex authentication; application-level RBAC.
- Modular monolith; no Kubernetes, microservices, vector DB or workflow engine.
- AI is asynchronous, proposal-based and human-approved.

## 2. Component view

```mermaid
flowchart TB
  subgraph Browser
    SPA[React SPA<br/>three-panel workspace]
  end
  subgraph nex
    Portal[nex portal<br/>SSO + hosting]
  end
  subgraph AWS
    APIGW[API Gateway HTTP API]
    API[FastAPI Lambda<br/>modular monolith]
    Worker[Transcript worker Lambda]
    PG[(RDS PostgreSQL)]
    S3[(S3 transcripts)]
    SQS[(SQS + DLQ)]
    Bedrock[Amazon Bedrock]
    CW[CloudWatch]
  end
  Portal --> SPA
  SPA -->|/api/v1/*| APIGW --> API
  API --> PG
  API --> S3
  API --> SQS --> Worker
  Worker --> PG
  Worker --> S3
  Worker --> Bedrock
  API --> CW
  Worker --> CW
```

The frontend is a static SPA. In production it is served by nex; API calls go to API Gateway. Locally Vite proxies `/api` to FastAPI and docker-compose uses nginx for the same same-origin contract.

## 3. Backend layering

```text
app/api/*.py        HTTP boundary: dependencies, status codes, response models
app/services/*.py   domain rules, transactions, audit; no HTTP details
app/models/*.py     SQLAlchemy entities and relationships
app/schemas/*.py    Pydantic request/response contracts
app/core/           auth, RBAC, serializers, errors
app/ai/             extractor interface, mock extractor, Bedrock adapter
```

Routers are thin. Services receive `(db, user, payload)` and either return ORM/serialized objects or raise domain errors (`NotFoundError`, `ForbiddenError`, `ConflictError`, `DomainValidationError`). A single exception handler in `main.py` maps them to JSON with `{detail, code, details}`.

### Transaction model

`get_db()` opens a SQLAlchemy session per request and commits once on success:

```python
try:
    yield db
    db.commit()
except Exception:
    db.rollback()
    raise
finally:
    db.close()
```

Services only `flush()`. Consequences:

- A task mutation and its audit event commit atomically.
- Multi-row operations (creating a session and its participants, applying a proposal and recording audit) are atomic.
- AI conflict handling is the one deliberate exception: when an apply fails with a conflict, the service marks the proposal `failed`, commits that state, and then raises `409`. This preserves the failure for the reviewer instead of rolling it back.

### SQLite / PostgreSQL portability

- String UUID primary keys (`String(36)`) avoid dialect-specific UUID handling.
- Enums are stored as `VARCHAR` (`native_enum=False`), so no PostgreSQL enum migrations are needed.
- JSON columns use SQLAlchemy `JSON` (JSONB can be introduced without changing the API).
- Timestamps are naive UTC (`utcnow()`); the SPA treats the API values as UTC.
- SQLite is used for tests and local development; PostgreSQL is the production target. `alembic check` runs in CI to prevent schema drift.

## 4. Authentication and authorization

### Authentication boundary

Two modes:

| Mode | Use | Identity source |
|---|---|---|
| `dev` | local, tests, demos | `X-Dev-User` (email or user id), defaults to `DEV_DEFAULT_USER_EMAIL` |
| `nex` | deployed | `X-Nex-User-Id`, `X-Nex-Email`, `X-Nex-Name`, `X-Nex-Roles` |

In `nex` mode the first request for an unknown identity provisions a user as an employee. Roles from `X-Nex-Roles` can elevate a user (`manager`, `admin`) but never demote them; de-provisioning is an explicit admin action. The API **trusts the headers**, so the nex gateway must strip any client-supplied copies before proxying. This is documented as an operational requirement.

`dev` mode refuses to run unless `ENVIRONMENT` is local/dev/development/test/ci.

### Authorization

RBAC is applied in `core/rbac.py`:

- **Employee** — read own tasks/projects they belong to; update own task status; add own updates; submit own pre-meeting note.
- **Manager** — all read; manage projects/tasks; facilitate sessions; review participants; capture meeting records; approve/apply AI proposals.
- **Admin** — manager plus user/role management.

Project visibility also considers ownership and `project_members`. Task visibility considers manager/admin, assignee, creator and project owner. The checks run in services, not only in routers, so every entry point is protected.

## 5. Standup workflow

### 5.1 Session lifecycle

```text
draft ──start──▶ in_progress ──complete──▶ completed
```

- One session per calendar date (`unique(session_date)`).
- Creating a session snapshots participants (`standup_participants`), skipping admins and users with `standup_eligible=false`.
- `start` sets `started_at`; `complete` sets `ended_at`, generates a structured summary and writes audit. Completion never resolves blockers or closes action items.
- The live workspace auto-starts a draft session when the facilitator opens it, but pre-meeting submissions remain open until each participant is reviewed. This makes late arrivals practical without losing the meeting timeline.

### 5.2 Exception-first classification

For the selected employee, tasks are loaded with their project, updates, blockers and action items, then grouped:

1. **Needs attention** — any open blocker, overdue task, `is_at_risk`, or open action item. Sorted by a severity score (blocked 100, overdue 50, at-risk 30, follow-up 10).
2. **Active** — `in_progress` or due within `UPCOMING_DUE_DAYS` (default 3), excluding closed tasks.
3. **Other** — everything else, including backlog and recently closed work; collapsed by default.

The API returns all three groups plus carried-forward blockers/action items and recent updates/decisions, so the workspace renders from one request per employee.

### 5.3 Carry-forward

Carry-forward is **query-driven**, not copied:

```text
open blocker  → status = 'open' AND (owner = employee OR task.assignee = employee)
open action   → status = 'open' AND (owner = employee OR task.assignee = employee)
```

They keep their `reported_session_id` / `session_id` origin, so history can answer “when was this first raised?”. Ending a session does not mutate them. Resolving/completing removes them from later workspaces automatically. This avoids duplicate records and guarantees continuity.

### 5.4 Capture context

Meeting capture endpoints are scoped by session:

- `POST /standups/sessions/{id}/updates` creates an append-only `TaskUpdate` with `source=standup`, `session_id`, author = manager, `attributed_to_user_id` = selected employee.
- blockers/action items/decisions inherit `session_id`; owners default to the selected employee on the client.
- Notes are stored as `session_notes` for free text that does not belong in a structured record.
- Every capture writes an audit event with `source=manager_action` and the session id.

### 5.5 Completion summary

The summary is deterministic and built from rows, not from an LLM: participants reviewed, progress update count, blockers reported/resolved, action items created/open, decisions, carried-forward blocker count and unreviewed names. It is stored on `standup_sessions.summary` and also returned by `GET .../summary`.

## 6. AI reconciliation pipeline

```mermaid
sequenceDiagram
  participant M as Manager
  participant API as FastAPI
  participant S3 as S3
  participant Q as SQS
  participant W as Worker
  participant B as Bedrock
  participant DB as PostgreSQL
  M->>API: upload transcript + session
  API->>S3: store file
  API->>DB: transcript row (uploaded)
  API->>Q: enqueue transcript id
  API-->>M: 201 (uploaded)
  W->>Q: receive
  W->>DB: context (tasks, blockers, session records)
  W->>B: transcript + context
  B-->>W: structured operations
  W->>DB: proposals (pending) + audit
  M->>API: approve / edit / reject
  M->>API: apply approved proposal
  API->>DB: version check → mutation + audit
```

### Safeguards

| Risk | Mechanism |
|---|---|
| AI mutating records silently | Proposals only; `apply` requires `status=approved` |
| Duplicate records | Token-Jaccard similarity against session updates/blockers/actions/decisions; `duplicate_of_type/id` shown to reviewer |
| Wrong task | Lexical matching + supplied context; weak/ambiguous matches set `is_ambiguous=true` and often `target_id=null` |
| Concurrent changes | `base_task_version` captured at generation; apply compares to `Task.version`, fails with `409`, preserves newer data, marks proposal failed |
| Lost approvals | Reviewer, timestamps, note and audit events (`generated`, `edited`, `approved`, `rejected`, `applied`, `failed`) |
| Model/provider failure | Transcript marked `failed` with error; retry/reprocess endpoint; SQS DLQ after 3 receives |

The mock extractor exists for deterministic tests and offline demos. It is intentionally not presented as production-quality extraction; the Bedrock adapter is the production path.

## 7. Concurrency and consistency

- **Task edits** accept `expected_version`. Mismatch → `409` with `current_version` and `expected_version`. Human UIs use this in the board/task editor; AI apply always enforces it.
- **Session date** is unique, so a duplicate create returns `409` with the existing session id.
- **Review/complete** checks are explicit: completing with unreviewed participants requires `force=true`; the response lists who is unreviewed.
- **No distributed locks.** A small team and optimistic checks are sufficient for the MVP. Real-time multi-manager synchronisation is deferred.
- **Audit is append-only.** There are no update/delete endpoints for audit rows. Corrections create new records.

## 8. Failure behaviour

| Failure | Behaviour |
|---|---|
| Validation | `422` with field-level details |
| Missing entity | `404` |
| Wrong role/ownership | `403` |
| Stale version / duplicate session / closed session | `409` with structured `details` |
| DB integrity race | `409` via `IntegrityError` handler |
| Unexpected DB error | `500` JSON; no partial commit |
| Transcript extraction error | transcript `failed`, error stored, audit event; job retried/DLQ |
| AI apply conflict | proposal `failed`, failure reason, task untouched, `409` to caller |

## 9. Performance and scaling notes

- Standup reads are bounded by team size and use `selectinload` for task relationships.
- Aggregates (per-session open counts, per-participant blocker/action counts) are done with grouped queries, not N+1 loops.
- Lambda → RDS connections are the main scaling constraint. The API Lambda is small; RDS Proxy or reserved concurrency should be added before a large rollout. Worker concurrency is capped at 2 in Terraform.
- Static frontend assets are served by nex/nginx, not Lambda.
- The database holds all operational history; no separate search infrastructure is needed at this scale.

## 10. Non-goals for this iteration

Kubernetes, microservices, event sourcing, vector search, configurable workflow engines, separate authentication, Teams Graph retrieval, real-time collaboration. These are deferred until usage demonstrates a need.
