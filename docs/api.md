# API reference

> **Active surface:** users, projects, tasks, blockers/action items/decisions, standups, today, daily updates, audit and meta. `GET/POST /ai/*` and `GET/POST /intake/*` are **no longer registered**; their sections below are retained only to describe historical data and audit. Board/table are client presentations over `/tasks`; there is no separate board endpoint.

Base path: `/api/v1` (configurable via `API_PREFIX`). Interactive OpenAPI: `/api/docs`, schema: `/api/openapi.json`. Health endpoints live outside the prefix: `/health`, `/health/ready`. `GET /meta` returns the server `business_date` (UTC team day) used by the UI for due/overdue labels.

## 1. Conventions

### Authentication headers

Local development (`AUTH_MODE=dev`):

```http
X-Dev-User: manager@nex.local
```

Deployed through nex (`AUTH_MODE=nex`):

```http
X-Nex-User-Id: <sso subject>
X-Nex-Email: person@corp.example
X-Nex-Name: Person Name
X-Nex-Roles: employee,nex-manager
```

The nex gateway must strip inbound copies of these headers. Role elevation is applied on first sight; users are never silently demoted.

### Errors

```json
{
  "detail": "Task changed since you loaded it. Refresh and re-apply your edit.",
  "code": "conflict",
  "details": { "current_version": 4, "expected_version": 2 }
}
```

| Status | Meaning |
|---|---|
| 400 | Bad request / unsupported operation |
| 401 | Missing or unknown identity |
| 403 | Authenticated but not allowed |
| 404 | Entity not found |
| 409 | Conflict: stale version, duplicate session, closed session, duplicate apply |
| 422 | Validation error |
| 500 | Unexpected server/database error |

HTTP 422 from FastAPI validation also returns the standard `detail` array.

### Pagination

List endpoints that paginate return:

```json
{ "items": [], "total": 0, "limit": 50, "offset": 0 }
```

`limit` defaults to 50 (max 200) and `offset` to 0.

### Dates and timestamps

- Dates: `YYYY-MM-DD`.
- Timestamps: ISO-8601 naive UTC (`2026-11-13T09:31:00`). The SPA renders them in local time.

---

## 2. Identity and users

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/auth/config` | public | `{mode: "dev" \| "nex"}` |
| GET | `/auth/dev-users` | public in dev only | identity picker; 404 otherwise |
| GET | `/me` | any | current user + `is_manager` |
| GET | `/users?include_inactive=false` | any authenticated | active users by default |
| POST | `/users` | admin | create user |
| PATCH | `/users/{id}` | admin | name, role, active, eligibility |

---

## 2.5 Today session state and daily updates

`/today` still provides session state and a check-in projection; the SPA has no Today page and uses it for the Tasks standup button. Daily updates are retained.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/today` | any authenticated | session state, paginated check-in, secondary commitments, recently completed work, general note |
| GET | `/daily-updates/today` | any authenticated | current user's general note or `null` |
| PUT | `/daily-updates/today` | any authenticated | upsert one general note per user per day |

`GET /today` parameters:

| Parameter | Default | Notes |
|---|---|---|
| `limit` | 25 | 1–100 check-in task rows |
| `offset` | 0 | paginate the full relevant set |
| `q` | — | task-title search |
| `assignee_id` | — | manager owner filter; ignored for employees (always assigned-only) |
| `recent_limit` | 10 | recently completed tasks, 1–25 |

Relevance is computed server-side: nonclosed tasks with open blockers, overdue dates, explicit risk or open follow-ups; in-progress tasks; to-dos due within the 7-day horizon or created since the cutoff; no full backlog. The cutoff is the previous completed standup’s `ended_at`, else the start of the business day, and is returned as `cutoff` plus a human `cutoff_label`. `recently_completed` contains done tasks whose `completed_at` is at/after the cutoff. Taskless blockers/follow-ups and commitments on closed tasks that are not represented by a check-in row appear in `other_commitments`.

```json
{
  "business_date": "2026-11-13",
  "session": {"id": "...", "status": "draft", "reviewed_count": 0, "participant_count": 4},
  "daily_update": {"progress": "Optional general note.", "next_steps": null},
  "cutoff": "2026-11-12T16:04:00",
  "cutoff_label": "Since the Nov 12 standup",
  "checkin": {
    "items": [{
      "id": "...",
      "title": "Attribution model v2",
      "project_name": "Marketing Attribution",
      "status": "in_progress",
      "assignee": {"id": "...", "full_name": "Priya Patel"},
      "due_date": "2026-11-17",
      "reasons": ["blocker", "at_risk", "follow_up"],
      "open_blockers": [{"id": "...", "description": "Warehouse access missing", "owner": null, "reported_by": {"full_name": "Maya Chen"}}],
      "open_action_items": [{"id": "...", "description": "Jordan to request access", "status": "open"}],
      "latest_update": {"progress": "Specification drafted", "created_at": "..."},
      "can_move": true
    }],
    "total": 13, "limit": 25, "offset": 0
  },
  "other_commitments": [
    {"kind": "blocker", "id": "...", "task_id": null, "title": "Team blocker", "detail": "Need design review", "owner": null, "reporter": {"full_name": "Maya Chen"}, "age_days": 0}
  ],
  "recently_completed": {"items": [], "total": 0, "limit": 10, "offset": 0}
}
```

A task appears once; `reasons` describe all its exceptions. Task owner (`assignee`) and help/follow-up owner are distinct fields. Inline note+status saves use `POST /tasks/{id}/updates`; no standup-submission endpoint exists.

### Daily general note

```http
PUT /api/v1/daily-updates/today
{ "progress": "Optional context for the standup.", "next_steps": "Publish tomorrow." }
```

One row per user/date; repeating the call updates the same row and records `daily_update.updated` audit. It never overwrites task progress updates.

---

## 3. Projects

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/projects?include_archived=false&q=` | any | employee sees owned/joined projects; includes the system Ad hoc project |
| POST | `/projects` | manager | `name`, `description`, `owner_id`, `status`, `member_ids`; “Ad hoc” is rejected |
| GET | `/projects/{id}` | member/manager/admin | owner, members, viewer-scoped task counts, `can_edit` |
| PATCH | `/projects/{id}` | owner/manager/admin | membership changes are manager-only; Ad hoc cannot be archived |

`ProjectOut` adds `system_key` (`"ad_hoc"` for the designated default) and `can_edit`. Task counts are scoped to tasks the viewer may see. The Ad hoc project is provisioned idempotently (stable key; one-time adoption of a single legacy name match; duplicates require deliberate reconciliation) and reconciles active users as members.

---

## 4. Tasks

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/tasks` | any (scoped) | filters below |
| POST | `/tasks` | project member/manager | cannot create directly as `done` |
| GET | `/tasks/{id}` | visible user | detail with updates/blockers/actions/decisions |
| PATCH | `/tasks/{id}` | assignee/creator/manager | supports `expected_version` |
| PATCH | `/tasks/{id}/status` | assignee/manager | `{status, expected_version?}` |
| GET | `/tasks/{id}/updates` | visible | newest first |
| POST | `/tasks/{id}/updates` | assignee/manager | create update; optional atomic status change, expected version and `client_operation_id` |
| PATCH | `/tasks/{id}/updates/{update_id}` | author or manager/admin | edit historic progress text; `expected_version` task version |
| DELETE | `/tasks/{id}/updates/{update_id}` | author or manager/admin | delete historic update; optional `expected_version` query; `204` |
| POST | `/tasks/{id}/blockers` | assignee/manager | creates an open blocker; status unchanged |
| GET | `/tasks/{id}/activity` | visible | audit events for the task + related blockers/actions/decisions |
| GET | `/tasks/{id}/history` | visible | progress updates (alias for the updates view) |

Task filters: `project_id`, `assignee_id` (use `unassigned` for tasks with no assignee), repeated `status`, `priority`, `blocked=true`, `overdue=true`, `q` (title substring), `sort`, `limit`, `offset`.

`sort` supports `due` (default), `title`, `owner`, `status`, `updated`, optionally prefixed with `-` for descending. Sorting applies to the entire filtered set with a stable `id` tie-breaker; undated tasks always sort last. Board lanes use the default due ordering; Table passes the chosen sort.

`TaskCreate.description`, when supplied, is stored on the task and also appended as the creator's first task update in the same transaction, so it appears in Latest update and task history immediately.

The SPA groups stored `backlog` and `todo` records under one **To Do** lane/status. The API still accepts both status values; new tasks use `todo`.

Task lists are ordered by `due_date` (undated last), then `updated_at` descending, then `id` ascending, so offset paging is stable when a card changes lane. `TaskOut.can_move` is computed from the same capability check as `PATCH /tasks/{id}` (manager, assignee, or creator) so clients can hide move affordances for read-only work.

### Atomic update + retry safety

`POST /tasks/{id}/updates` accepts:

```json
{
  "progress": "Validated Q4 totals.",
  "next_steps": "Publish tomorrow.",
  "status": "done",
  "expected_version": 3,
  "client_operation_id": "9f6c3e2a-..."
}
```

The progress row and optional status change commit in one transaction. A stale `expected_version` returns `409` and writes neither. Repeating the call with the same `client_operation_id` returns the original update instead of creating a duplicate. Create endpoints (`POST /tasks`, `/blockers`, `/action-items`, `/decisions`, session `/notes`) accept the same retry id.

### Editing and deleting historic updates

`PATCH /tasks/{id}/updates/{update_id}` requires `progress` (trimmed nonblank) and accepts optional `next_steps` and `expected_version` (the task version). Omitted `next_steps` is preserved; explicit `null`/blank clears it. `DELETE` accepts optional `expected_version` as a query parameter and returns `204`.

Update lookup is scoped to the task, so a missing or mismatched update id returns `404`. The task must remain visible; only the recorded `author_id` or a manager/admin may edit/delete. `attributed_to_user_id` is attribution, not authorship. Mutations bump `Task.version`/`updated_at`; stale versions return `409` with `current_version`/`expected_version`. Task status, owner, priority, blockers and the update's author, attribution, session, source and `created_at` are preserved. Audit records `task.update_edited`/`task.update_deleted` under the task, retaining prior values and the original session id.

### Task lifecycle

```text
backlog ↔ todo ↔ in_progress ↔ done
                    ↕
                canceled
```

Entering `done` sets `completed_at`; reopening clears it. Any status is allowed with an audit event. Blockers are independent: resolving one does not change `status`.

### Concurrency example

```http
PATCH /api/v1/tasks/6f... HTTP/1.1
Content-Type: application/json

{ "title": "New title", "expected_version": 3 }
```

If the stored version is 4:

```http
HTTP/1.1 409 Conflict
{
  "detail": "Task changed since you loaded it. Refresh and re-apply your edit.",
  "code": "conflict",
  "details": {"current_version": 4, "expected_version": 3}
}
```

---

## 5. Blockers, action items and decisions

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/blockers` | any (scoped) | `task_id`, `owner_id`, `open_only=true` |
| POST | `/blockers` | any authenticated | task-linked or team-wide help request; optional owner |
| PATCH | `/blockers/{id}/resolve` | owner/reporter/manager | requires `resolution_details` |
| GET | `/action-items` | any (scoped) | `session_id`, `owner_id`, `open_only` |
| POST | `/action-items` | manager | general/outside-session follow-up |
| PATCH | `/action-items/{id}` | owner/manager | status, owner, due date, description |
| GET | `/decisions` | any (scoped) | `session_id`, `task_id` |
| POST | `/decisions` | manager | general or task/project-linked |

Resolving a blocker preserves task status and records `resolved_at`, `resolved_by`, `resolution_details`, `resolved_session_id` and an audit event.

---

## 6. Standups (active session only)

> Past-standup list, summary, captures, outcomes, timeline, user history and carry-forward endpoints are removed. Session, workspace and live-capture endpoints remain for the current standup; historical rows are retained but not exposed. `/standups` and `/standups/:id` redirect to Tasks in the SPA.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/standups/today` | any | today's session or `null` |
| POST | `/standups/sessions` | manager | `{session_date?, participant_ids?, facilitator_id?}` |
| GET | `/standups/sessions/{id}` | participant/manager | participants + pre-meeting notes |
| POST | `/standups/sessions/{id}/start` | manager | idempotent if already in progress |
| POST | `/standups/sessions/{id}/complete` | manager | `{notes?, force?}` |
| POST | `/standups/sessions/{id}/participants/{user_id}/pre-meeting` | self (until reviewed) | legacy pre-meeting contract; the UI uses daily updates and direct task updates |
| GET | `/standups/sessions/{id}/participants/{user_id}/workspace` | participant/manager | exception-first workspace |
| PATCH | `/standups/sessions/{id}/participants/{user_id}` | manager | `reviewed`, `follow_up_flagged`, `follow_up_note` |
| POST | `/standups/sessions/{id}/updates` | manager | record progress in the meeting |
| POST | `/standups/sessions/{id}/blockers` | manager | report blocker |
| PATCH | `/standups/sessions/{id}/blockers/{blocker_id}/resolve` | manager | resolve in meeting |
| POST | `/standups/sessions/{id}/action-items` | manager | create follow-up |
| POST | `/standups/sessions/{id}/decisions` | manager | record decision |
| POST | `/standups/sessions/{id}/notes` | manager | free-text note |
| PATCH | `/standups/sessions/{id}/tasks/{task_id}/status` | manager | status change attributed to the session |

### Create today's session

```http
POST /api/v1/standups/sessions
{ "session_date": "2026-11-13", "participant_ids": ["...", "..."] }
```

`session_date` defaults to today; participants default to active, `standup_eligible`, non-admin users. Duplicate date → `409` with `details.session_id`.

### Workspace response (abridged)

```json
{
  "session_id": "...",
  "participant": {
    "id": "...",
    "user": {"id": "...", "full_name": "Priya Patel", "role": "employee"},
    "pre_meeting_progress": "Dashboard validation is complete.",
    "pre_meeting_submitted_at": "2026-11-13T09:31:00",
    "reviewed_at": null,
    "open_blocker_count": 2,
    "open_action_item_count": 1
  },
  "needs_attention": [
    {
      "id": "...",
      "title": "Attribution model v2",
      "status": "in_progress",
      "priority": "high",
      "is_blocked": true,
      "is_overdue": false,
      "is_at_risk": true,
      "reasons": ["blocker", "at_risk", "follow_up"],
      "open_blockers": [{"id": "...", "description": "...", "age_days": 3}],
      "open_action_items": [{"id": "...", "description": "...", "status": "open"}],
      "latest_update": {"progress": "...", "source": "standup"}
    }
  ],
  "active": [],
  "other": [],
  "carried_blockers": [{"kind": "blocker", "id": "...", "age_days": 3, "origin_session_date": "2026-11-10"}],
  "carried_action_items": [],
  "recent_updates": [],
  "recent_decisions": []
}
```

### Capture progress

```http
POST /api/v1/standups/sessions/{session_id}/updates
{
  "task_id": "...",
  "progress": "Validated Q4 totals with finance.",
  "next_steps": "Publish the dashboard.",
  "attributed_to_user_id": "..."
}
```

The record gets `source=standup`, `session_id`, author = current manager and an audit event with `source=manager_action`.


### Complete

```http
POST /api/v1/standups/sessions/{session_id}/complete
{ "notes": "Finance joins tomorrow.", "force": false }
```

If participants are unreviewed and `force=false`, `409` with `details.unreviewed_user_ids`. Completion never resolves open blockers/actions.

---

## 7. Work intake (retired — route not registered)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/intake?status=` | employee own, manager all | |
| POST | `/intake` | any authenticated | title, description, priority, requester_name |
| GET | `/intake/{id}` | requester/manager | |
| PATCH | `/intake/{id}` | manager | status, priority, review note |
| POST | `/intake/{id}/convert-to-task` | manager | project_id required; optional title/assignee/due/priority |
| POST | `/intake/{id}/convert-to-project` | manager | optional name/description/member_ids |

Converting twice → `409`.

---

## 8. Audit

`GET /audit` — paginated. Filters: `entity_type`, `entity_id`, `session_id`, `event_type`, `source`, `start`, `end`.

Managers see the full trail. Employees see events they acted on, events in sessions they participate in, and events for tasks they own/created. Audit rows are append-only; no mutation verbs are exposed.

---

## 9. AI reconciliation (retired — routes not registered; retained records)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/ai/transcripts` | manager | multipart `file`, optional `session_id` form field |
| GET | `/ai/transcripts` | manager | recent uploads |
| GET | `/ai/transcripts/{id}` | manager | metadata + proposals |
| POST | `/ai/transcripts/{id}/reprocess` | manager | supersedes pending proposals, re-runs extraction |
| GET | `/ai/proposals` | manager | filter `status`, `transcript_id`, `session_id` |
| GET | `/ai/proposals/{id}` | manager | |
| PATCH | `/ai/proposals/{id}` | manager | edit `payload` / `review_note` (pending only) |
| POST | `/ai/proposals/{id}/approve` | manager | `{note?}` |
| POST | `/ai/proposals/{id}/reject` | manager | `{note?}` |
| POST | `/ai/proposals/{id}/apply` | manager | requires approved; version checked |

### Proposal shape (abridged)

```json
{
  "id": "...",
  "operation": "add_progress_update",
  "target_type": "task",
  "target_id": "...",
  "payload": {"progress": "...", "next_steps": "..."},
  "current_values": {"status": "in_progress", "assignee_id": "...", "title": "..."},
  "evidence_excerpt": "Yesterday I finished the revenue dashboard...",
  "speaker": "Priya Patel",
  "spoken_at": "10:01:00",
  "confidence": 0.9,
  "is_ambiguous": false,
  "duplicate_of_type": null,
  "duplicate_of_id": null,
  "status": "pending",
  "base_task_version": 3
}
```

### Retry ids

All create commands accept an optional `client_operation_id` (max 64 chars, unique). Reuse the same id for a retry of the same logical submission; use a new id for a new record. Daily updates are upserts keyed by user + date.

### UI review

The frontend presents proposals as human-readable before/after changes (task, owner, status, description) rather than JSON. The API shape above is unchanged.

### Apply conflict

```http
HTTP/1.1 409 Conflict
{
  "detail": "Task changed after this proposal was generated. Re-evaluate before applying.",
  "code": "conflict",
  "details": {"current_version": 5, "proposal_base_version": 3}
}
```

The proposal is persisted as `failed` with `failure_reason`; the task keeps its newer state. The reviewer can reject/close it or reprocess the transcript.

---

## 10. Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness; service/environment |
| GET | `/health/ready` | executes `SELECT 1` against the database |
| GET | `/meta` | server business date used for date/overdue labels (no auth required) |

These endpoints are intentionally unauthenticated for load balancers and monitoring.
