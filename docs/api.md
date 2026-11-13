# API reference

Base path: `/api/v1` (configurable via `API_PREFIX`). Interactive OpenAPI: `/api/docs`, schema: `/api/openapi.json`. Health endpoints live outside the prefix: `/health`, `/health/ready`.

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

## 3. Projects

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/projects?include_archived=false` | any | employee sees owned/joined projects |
| POST | `/projects` | manager | `name`, `description`, `owner_id`, `status`, `member_ids` |
| GET | `/projects/{id}` | member/manager/admin | includes owner, members, task counts |
| PATCH | `/projects/{id}` | owner/manager/admin | membership changes are manager-only |

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
| POST | `/tasks/{id}/updates` | assignee/manager | append-only progress update |
| POST | `/tasks/{id}/blockers` | assignee/manager | creates an open blocker; status unchanged |
| GET | `/tasks/{id}/activity` | visible | audit events for the task + related blockers/actions/decisions |
| GET | `/tasks/{id}/history` | visible | progress updates (alias for the updates view) |

Task filters: `project_id`, `assignee_id`, repeated `status`, `priority`, `blocked=true`, `overdue=true`, `q` (title substring), `limit`, `offset`.

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
| PATCH | `/blockers/{id}/resolve` | owner/reporter/manager | requires `resolution_details` |
| GET | `/action-items` | any (scoped) | `session_id`, `owner_id`, `open_only` |
| POST | `/action-items` | manager | general/outside-session follow-up |
| PATCH | `/action-items/{id}` | owner/manager | status, owner, due date, description |
| GET | `/decisions` | any (scoped) | `session_id`, `task_id` |
| POST | `/decisions` | manager | general or task/project-linked |

Resolving a blocker preserves task status and records `resolved_at`, `resolved_by`, `resolution_details`, `resolved_session_id` and an audit event.

---

## 6. Standups

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/standups/today` | any | today's session or `null` |
| GET | `/standups/sessions?status=` | manager all, employee participating | paginated, newest first, includes open counts |
| POST | `/standups/sessions` | manager | `{session_date?, participant_ids?, facilitator_id?}` |
| GET | `/standups/sessions/{id}` | participant/manager | participants + pre-meeting notes |
| POST | `/standups/sessions/{id}/start` | manager | idempotent if already in progress |
| GET | `/standups/sessions/{id}/summary` | participant/manager | preview or completed summary |
| POST | `/standups/sessions/{id}/complete` | manager | `{notes?, force?}` |
| POST | `/standups/sessions/{id}/participants/{user_id}/pre-meeting` | self (until reviewed) | progress / next steps / blockers / task updates |
| GET | `/standups/sessions/{id}/participants/{user_id}/workspace` | participant/manager | exception-first workspace |
| PATCH | `/standups/sessions/{id}/participants/{user_id}` | manager | `reviewed`, `follow_up_flagged`, `follow_up_note` |
| POST | `/standups/sessions/{id}/updates` | manager | record progress in the meeting |
| POST | `/standups/sessions/{id}/blockers` | manager | report blocker |
| PATCH | `/standups/sessions/{id}/blockers/{blocker_id}/resolve` | manager | resolve in meeting |
| POST | `/standups/sessions/{id}/action-items` | manager | create follow-up |
| POST | `/standups/sessions/{id}/decisions` | manager | record decision |
| POST | `/standups/sessions/{id}/notes` | manager | free-text note |
| GET | `/standups/sessions/{id}/notes` | participant/manager | session notes |
| PATCH | `/standups/sessions/{id}/tasks/{task_id}/status` | manager | status change attributed to the session |
| GET | `/standups/sessions/{id}/captures` | participant/manager | all structured records captured in the session |
| GET | `/standups/sessions/{id}/timeline` | participant/manager | audit events for the session |
| GET | `/standups/users/{user_id}/history?start=&end=&limit=` | self/manager | historical reports, blockers, actions, decisions |
| GET | `/standups/users/{user_id}/carry-forward` | self/manager | open blockers/action items, at-risk and overdue tasks |

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

## 7. Work intake

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

## 9. AI reconciliation

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

These endpoints are intentionally unauthenticated for load balancers and monitoring.
