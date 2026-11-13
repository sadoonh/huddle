# Design decisions

Short ADR-style notes for the choices that shape the MVP. Each entry states context, decision and consequences.

---

## ADR-001 — The standup workspace is the product, not a feature

**Context:** Generic trackers optimise for browsing and planning. The team's actual pain is the daily meeting: locating relevant work, recording decisions and keeping commitments alive.

**Decision:** Build a dedicated three-panel workspace (employee navigation, exception-first task view, meeting capture) and make it the manager's default route. The Kanban board is explicitly secondary.

**Consequences:** The task foundation stays deliberately small. Board/planning features are deferred until usage demonstrates a need. The UI invests in selection state, capture context and review progress rather than drag-and-drop polish.

**Update (ADR-015):** The meeting is now a focused mode entered from Today, not a persistent three-panel destination. The Kanban board is legacy/pilot only.

---

## ADR-002 — Exceptions first, routine work collapsed

**Context:** Reviewing every task equally wastes meeting time and hides risk.

**Decision:** Classify tasks into Needs attention (open blocker, overdue, at-risk, open follow-up), Active (in progress or due soon) and Other (collapsed). Sort attention items by severity: blocked > overdue > at risk > follow-up.

**Consequences:** A manager can run the meeting from the first two groups. Closed/backlog work remains accessible but not distracting. Classification is computed server-side so every client sees the same priority.

---

## ADR-003 — Carry-forward is a query, not a copy

**Context:** Copying unresolved items into each new session creates duplicates and breaks the link to when an issue was first raised. Closing a meeting must not erase open commitments.

**Decision:** Open blockers and action items remain attached to their origin session. Every workspace queries them live by owner/assignee. Resolving or completing removes them from later meetings automatically.

**Consequences:** No duplication, no batch “carry” job, and history answers “when was this first raised?” directly. The trade-off is that later sessions do not own their carried items; the UI labels origin date and age.

---

## ADR-004 — Blockers are separate from workflow status

**Context:** A task can be actively worked while something external prevents completion. Collapsing that into a “blocked” status loses the real workflow state.

**Decision:** `tasks.status` and blocker state are independent. `is_blocked` is computed from open blockers; tasks can also be flagged at risk with a reason.

**Consequences:** A task stays `in_progress` while blocked, preserving progress visibility. Reports can distinguish “blocked” from “not started”. The cost is one extra join/relationship in task serialization.

---

## ADR-005 — Append-only history and one transaction per request

**Context:** The brief requires traceable changes and corrections that do not silently delete history.

**Decision:** Progress updates and audit events are append-only. Services mutate rows and write audit events in the same SQLAlchemy session; the request dependency commits once.

**Consequences:** A task change and its audit record cannot diverge. There are no audit mutation endpoints. Corrections create new records. Audit stores before/after JSON snapshots rather than a full event-sourced model, which is sufficient for review and cheaper to operate.

---

## ADR-006 — Optimistic concurrency with a task version

**Context:** Two managers (or a manager and an AI proposal) can touch the same task. Last-write-wins would silently destroy newer information.

**Decision:** Every accepted task edit increments `tasks.version`. Human edits may send `expected_version`; the API returns `409` with the current version on mismatch. AI proposals capture `base_task_version` at generation and re-check it at apply.

**Consequences:** No distributed locks or long transactions. The UI must handle 409s (it does, with a clear message). Stale AI proposals fail safely and are recorded as `failed`.

---

## ADR-007 — AI proposes explicit operations; humans approve

**Context:** Transcript extraction is probabilistic. Silent writes to production task records would be unacceptable.

**Decision:** Extraction emits typed operations (`update_task_status`, `add_progress_update`, `create_blocker`, …) with evidence. They are stored as proposals with review states. Applying requires approval and a version check. Duplicates and ambiguous matches are surfaced to the reviewer.

**Consequences:** The reconciliation workflow adds review time, but it is auditable and reversible in the sense that no unapproved change exists. The model cannot invent task references because only IDs from supplied context are applied.

---

## ADR-008 — Reuse nex SSO instead of building authentication

**Context:** The application is hosted inside nex. A second login or a separate Cognito user pool would fragment identity.

**Decision:** Trust SSO headers injected by the nex gateway (`AUTH_MODE=nex`). Provision users on first sight; use header roles only to elevate. Local development uses a dev identity switch.

**Consequences:** The gateway must strip client-supplied identity headers — a documented operational requirement. Authorization remains application-level (RBAC + project/task checks), so the API does not rely on the portal for permissions. If nex later exposes JWT verification, the auth dependency can be swapped without touching services.

---

## ADR-009 — SQLAlchemy + Alembic, SQLite locally, PostgreSQL in production

**Context:** The team needs fast local tests without requiring Postgres, but production is RDS.

**Decision:** Use SQLAlchemy 2 with portable types (string UUIDs, JSON, non-native enums) and Alembic for the schema. Tests run on SQLite; CI runs `alembic check`; production runs PostgreSQL.

**Consequences:** No dialect-specific features (e.g. partial indexes, JSONB operators) in the MVP. The trade-off is portability and a simple dev setup. If Postgres-only features become necessary, tests should move to a Postgres service in CI.

---

## ADR-010 — Asynchronous AI via SQS worker

**Context:** Transcript extraction calls an external model and can take seconds. Blocking an HTTP request is fragile and the brief requires asynchronous processing.

**Decision:** The API stores the transcript, enqueues its id and returns. A worker Lambda performs extraction and proposal generation. A DLQ captures repeated failures. Inline processing remains available for local demos/tests.

**Consequences:** One more deployable component (same image) and queue infrastructure. Upload responses return `uploaded` rather than `processed`; the UI can refresh or process inline. No workflow engine is introduced.

---

## ADR-011 — Mock extractor for deterministic tests

**Context:** Bedrock calls are non-deterministic, cost money and require credentials in CI.

**Decision:** Provide a heuristic `MockExtractor` behind the same interface as Bedrock. Tests exercise the full proposal → review → apply pipeline against it. Bedrock is selected by configuration.

**Consequences:** CI is fast and deterministic. The mock is not production-quality extraction and is not presented as such; the Bedrock prompt and matching logic still need validation against authorized real transcripts.

---

## ADR-012 — Modular monolith, not microservices

**Context:** The team is small and the MVP must ship quickly on existing infrastructure.

**Decision:** One FastAPI service (plus an async worker sharing the same image), one database, one frontend. Modules are separated by router/service/model boundaries.

**Consequences:** Local development and deployment stay simple. Scaling is vertical/parameter-driven (Lambda memory/concurrency, RDS size). Splitting services later is possible along the existing module boundaries but is not planned without evidence.

---

## ADR-013 — Pre-meeting updates stay open until reviewed

**Context:** Employees may not submit before the manager opens the session; a strict “draft only” rule makes the optional pre-meeting flow unreliable in practice.

**Decision:** Allow submission while the session is `draft` or `in_progress`, until that participant is marked reviewed. A completed session always closes input.

**Consequences:** Late arrivals can still contribute, and managers can start on time. The data is still labelled as pre-meeting input and is attributed to the employee. The trade-off is that a submission can arrive after the meeting has started; the workspace refreshes on demand.

**Update (ADR-015):** The daily UI no longer uses the multi-question pre-meeting form. It writes one optional date-scoped daily update, or a task update. The pre-meeting endpoints remain for compatibility and history.

---

## ADR-014 — Deterministic session summary, not an LLM summary

**Context:** Historical questions must be answerable from structured data without relying on a model.

**Decision:** Generate the session summary from counts of structured rows (reviews, updates, blockers created/resolved, action items, decisions, carried-forward blockers). Store the text on the session.

**Consequences:** Summaries are reproducible and auditable. They are terse rather than narrative. Narrative summaries could be added later as a separate, clearly labelled AI artifact.

---

## Deferred decisions

- **Microsoft Graph integration** — requires organisational permissions, recording policy and data-governance sign-off. The manual upload path validates value first.
- **RDS Proxy** — introduce when Lambda concurrency causes connection pressure.
- **Real-time collaboration** — polling/refresh is sufficient for one facilitator; version checks prevent silent overwrites.
- **Multi-team tenancy** — the MVP is per-team; adding `team_id` to projects/sessions would be the next schema change if needed.
- **Notification delivery** — follow-ups are visible in-app only; email/Teams notifications need a delivery channel decision.


---

## ADR-015 — Simplify to Today + Work and a focused meeting

**Context:** The first implementation exposed seven equal navigation destinations, a three-panel meeting screen, duplicate status/complete/review indicators, an overview-style home, and several peripheral workflows. The product review found that users had to understand the application's organization before doing their work. There was no usage evidence that intake, Kanban, or transcript processing should be removed outright, so the decision was to simplify the default experience while preserving data and pilot access.

**Decision:**

1. Reduce primary navigation to **Today** and **Work**. Past standups, project settings, intake, transcript review and the legacy board become contextual or pilot tools.
2. Make Today act, not summarize: one state-aware standup action, one server-ordered attention queue, a short current-work preview for employees, and one optional “Anything changed?” composer. Remove pulse tiles, duplicate task lists, recent-history panels and manager “My work”.
3. Replace the pre-meeting questionnaire with a date-scoped `daily_updates` row (one upsert per user/day) and make “Needs help” create a durable blocker rather than storing blocker text on the participant.
4. Make Today and the meeting share one attention definition and ordering (`app/services/attention.py`).
5. Turn the meeting into a focused, navigation-free mode: compact person selector, on-demand roster, one main workspace and a contextual capture drawer. Keep one review indicator and one Finish action.
6. Retire the participant follow-up flag from new UI use; use owned action items. Preserve old flags in history.
7. Make session history outcome-first: Next actions, Unresolved help needed, Decisions. Collapse progress, participant reporting, facts and audit.
8. Replace the default Kanban with a Work list; keep the board at `/legacy/board` during the pilot. Redirect old URLs.
9. Keep intake, AI and project settings behind Pilot tools; make AI proposals human-readable instead of JSON, preserving approval, evidence, duplicate/ambiguity and stale-version safeguards.

**Consequences:**

- The default surface has two destinations and one dominant action per workflow step.
- Daily updates gain a new table (`daily_updates`) and employees can create taskless help requests.
- The pre-meeting API, board, intake, transcripts, proposals, participant flags and all audit/history data remain. Nothing was destructively migrated.
- The server now defines attention, reducing dashboard/meeting inconsistency and enabling full-set pagination.
- Full capture idempotency keys remain a follow-up; daily updates are upserts and the UI guards double submission.
- Phase 4 removals (deleting legacy modules/data) are explicitly deferred until a pilot confirms no one relies on them.

**Status:** Implemented in the current codebase; pilot pending.
