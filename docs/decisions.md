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

**Decision:** Trust SSO headers injected by the nex gateway (`AUTH_MODE=nex`). Provision users on first sight; use header roles only to elevate. Local development signs in as a fixed demo identity (Maya Chen) with no in-app switcher; automated tests may override the dev header identity via local storage.

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

**Superseded in part by ADR-017:** Work is a Kanban board again. The rest of this decision (Today, focused standup, pilot gating) still stands.

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


---

## ADR-016 — Trust-preserving interaction model

**Context:** The simplified structure was in place, but a polish audit found trust and completeness defects: stale data during slow identity/participant switches, background refreshes overwriting dirty forms or expected versions, progress and status saved as separate requests, receipts losing task identity, missing no-task capture paths, inaccessible overlays, and prototype-language surfaces.

**Decision:**

1. **Key data by identity and record.** Route content remounts on identity change. The meeting derives an active workspace only when `session_id` and participant match the selection; old actionable tasks are never rendered under a new name.
2. **Freeze the base version** when an edit/capture draft opens. Background refresh may update read-only context but cannot move the version the user is editing; conflicts require **Load latest state** and a deliberate re-save.
3. **Atomic writes.** Progress plus optional status is one transaction with one expected version. A conflict rolls back both. Distinct create/update commands accept unique `client_operation_id` values for response-loss retries.
4. **Explain saves with records.** Receipts carry kind, id, task context, text and timestamp. Daily notes remain separate from task updates; task updates are append-only and offer **View update** / **Add correction**, never an edit that implies history replacement.
5. **Guard drafts consistently.** Task/capture/create dialogs use the same in-app discard confirmation for Close, Cancel, Escape, backdrop, participant changes, meeting exit and SPA Back. Saves in flight block dismissal. Pristine forms close immediately.
6. **Complete the missing paths.** Person-level and zero-task help/follow-up/capture actions, manager reassignment in task detail, taskless blocker resolution in outcomes, captured-note display, current daily-update reporting, and full attention pagination.
7. **Read-first task detail.** Opening a task shows state, latest update, help and follow-ups first; metadata editing is a separate mode. New tasks are a short form with optional details and authorized inline project creation.
8. **URL-backed Work.** Active/Completed/All scope, search, filters, pagination and the selected task live in the URL; filter chips are removable and empty states distinguish search, filters, no active work and no work.
9. **One accessible overlay.** Portal rendering, labelled dialogs, focus trap, inert background, scroll lock, topmost-only Escape, focus restoration and mobile full-height surfaces are shared by modals, drawers and confirmations.
10. **One day boundary.** The server UTC date is the team business date (`/meta`, `/today`); the UI uses it for due/overdue and daily updates. Closed historical tasks show dates, not “overdue”.
11. **Production presentation.** Compact header navigation replaces the sidebar. Pilot tools, legacy board and development identity overrides are absent from normal production builds unless explicitly configured (`VITE_ENABLE_PILOT` / `AUTH_MODE=dev`).

**Consequences:**

- More service/schema surface (retry ids, business date) but fewer ambiguous client behaviours.
- `Task.version`, `client_operation_id` and atomic updates are now part of the correctness contract.
- Draft privacy and focus behaviour are centralized; new dialogs must use the shared primitives.
- The app still has no automated frontend test runner; the critical journeys are exercised with Playwright against the running app and must be repeated for the pilot.
- Screen-reader and 200% zoom validation remain manual pilot tasks, as does real-user testing.

**Status:** Implemented in the current codebase; frontend automation and formal accessibility audit are follow-ups, not claims of completion.


---

## ADR-017 — Work is the Kanban board; the component surface is elevated

**Superseded in part by ADR-019:** Work is now Tasks with Board and Table; the component family, brand and reliability rules remain.

**Context:** The simplification pass removed the board from the default experience and made Work a filtered list. A follow-up design review found the product structure right but the components still looked like default forms and bordered rows. The team also wanted the board’s cross-lane workflow back, without the legacy board’s five-column, 200-task, native-drag implementation.

**Decision:**

1. **Work is Kanban.** Four default lanes (Backlog, To do, In progress, Done), with Canceled reachable through **Show canceled** and **Cancel task**. Database statuses are unchanged; blocked/at-risk stay independent conditions rather than columns. This supersedes the list-first recommendation in `docs/simplification-plan.md`; ADR-015 remains the record of that earlier decision.
2. **Per-lane data, honest totals.** Each lane fetches its own filtered status page (`limit`/`offset`, 20 cards initially) with stable server sorting (`due_date` nulls-last, `updated_at`, `id`). A failing or slow lane never blanks the board; totals always come from the server count rather than the loaded slice.
3. **Movement is a status mutation.** Pointer drag (6px activation threshold, mouse only for this release), a keyboard lift/move/drop handle, and **Move to…** all submit the existing `/tasks/{id}/status` call with `expected_version`. Optimistic placement is reconciled on rejection; `409` loads the current task and explains the conflict instead of forcing the stale move. Same-lane dragging is a no-op because the model has no persisted rank.
4. **Server-computed capability.** `TaskOut.can_move` mirrors `ensure_task_editable` so read-only tasks render without move affordances instead of discovering a 403.
5. **One action snackbar.** The existing toast stack gained one optional action; board moves offer **Undo**, which performs a real version-checked reverse mutation and refuses to overwrite newer changes.
6. **A shared component family.** Raised task cards, recessed lanes, a morphed picker (portal, collision handling, keyboard/typeahead), a segmented control with announced selection, a confirmed-result async button, a stroke-drawn completion control, a right-side detail sheet, and the existing accessible overlays are used across Work, Today, the focused standup, and outcomes. Motion is event-driven, short, and removed under `prefers-reduced-motion`; reduced motion keeps all state feedback.
7. **URL contract.** Scope, project, owner, priority, exceptions, status filter, canceled column, selected task, and mobile lane are URL state. Legacy `view`/`completed`/`page` parameters are translated on load, and `/board` keeps redirecting to Work with its project context.
8. **Legacy board stays a pilot tool.** `/legacy/board` is retained for comparison only and is not part of normal navigation; it is not a second Work board.

**Consequences:**

- The board needs one small server contract addition (`can_move`) and a deterministic sort tie-breaker; no new tables or migrations.
- Rank ordering, touch drag, and server-side board snapshots remain explicit follow-ups.
- Task detail is now a sheet, but its business logic, draft protection, and conflict handling are the same shared implementation.
- The browser smoke test covers menu/keyboard/undo moves and the narrow single-lane layout; the later Tasks/Projects screenshots live in `docs/screenshots/tasks-*.png`.

**Status:** Implemented; pilot validation of drag, keyboard, and reduced-motion experiences is pending.


---

## ADR-018 — Extend the nex Charcoal Neutral brand from the parent portal

**Context:** The app is launched from the nex portal but used a standalone emerald/stone palette, a check-mark logo and Inter typography. The parent portal's approved Charcoal Neutral v1.2 kit defines the shared identity: charcoal header, Signal Teal wordmark accent, Action Teal interactions on white, Manrope headings and DM Sans UI text. The app should look like the same product family on first paint.

**Decision:**

1. **Adopt the kit's tokens, not a lookalike.** `docs/brand-kit/` holds the supplied identity, palette, tokens and wordmarks. Semantic app tokens in `tailwind.config.js` / `index.css` use the kit values: Canvas `#F6F7F8`, White surfaces, Ink `#252A31`, Secondary `#66717C`, Light Border `#E1E5E9`, Whisper Teal `#EAF7F4`, Action Teal `#087F77`, Signal Teal `#38D9C5`, Charcoal `#292D34`/`#363B43`/`#454B53`.
2. **Charcoal app header.** The header uses the portal's 105° charcoal gradient, dark border, subtle teal radial/ring decoration, and light-on-charcoal navigation. It keeps the portal's identity at app scale: a 72px desktop / 61px mobile minimum height (20% shorter than the portal's 90/76 homepage header) and the Space Grotesk `nex` wordmark (white `ne` + Signal Teal `x`). Reading pages keep their narrow content width while the header stays brand-wide, matching the portal's header/catalog relationship. Header menus and pickers render above the header without clipping.
3. **Contrast rules are enforced.** Action Teal is used for links, focus and primary buttons on white. Signal Teal is reserved for charcoal surfaces and brand highlights; it is never used as text on white. Semantic danger/warning ramps stay independent so status meaning is not lost in the brand palette.
4. **Typography.** Manrope ExtraBold for headings, DM Sans for body, controls and metadata, Space Grotesk for the wordmark. Fonts load from Google Fonts with system fallbacks; no display font is introduced beyond the kit.
5. **Surfaces and shape.** Card radius 16px, control radius 11px, sheet radius 18px, neutral-first borders and soft shadows, `0.24s`-family settle motion with the existing `prefers-reduced-motion` override. Task cards keep the restrained 1px hover lift from ADR-017; the brand's -3px tool-card lift is for the portal catalog, not dense board cards.
6. **Legacy utilities inherit the theme.** The Tailwind `slate`, `emerald`, `sky`, `indigo`, `rose` and `amber` ramps are remapped to brand-derived neutrals, teals and semantic brick/amber. Older pilot screens therefore inherit the palette without duplicating every component, while new work uses the semantic tokens (`canvas`, `raised`, `hairline`, `accent`, `ink`).
7. **Fixed local identity until Cognito.** There is no in-app identity switcher. Local development signs in as Maya Chen (`manager@nex.local`); automated tests may override the dev identity through local storage. Production identity will come from nex SSO/Cognito.
8. **Interaction semantics do not change.** ADR-016's trust model and ADR-017's Kanban/component family remain authoritative; this decision changes visual identity, not authorization, versioning, URL state or overlay behavior.

**Consequences:**

- The app now depends on Google Fonts at runtime; system stacks keep it functional offline. Self-hosting Manrope/DM Sans/Space Grotesk is a follow-up if the portal forbids external font requests.
- Local development has one fixed identity (Maya Chen) until Cognito is wired in; employee flows remain covered by automated tests that override the dev header identity out of band.
- Brand changes are centralized in tokens and the header; pilot pages pick them up via the remapped utility palettes.
- Screenshots and the Playwright smoke run were regenerated against the branded shell; header identity controls and board selectors remain stable for automation.

**Status:** Implemented; formal brand contrast/typography sign-off and self-hosted fonts remain follow-ups.


---

## ADR-019 — Today, Tasks and Projects; retire the pilot surfaces

**Superseded in part by ADR-020:** the Tasks-led shell, unified To Do category and ephemeral standup replace the Today/outcomes navigation. **Superseded in part by ADR-021:** Projects is a filter/create inside Tasks, not a primary destination.

**Context:** Earlier decisions split the product into Today + Work, then restored Kanban as Work and kept intake, transcript review and the legacy board behind Pilot tools. A further review found the navigation still described an internal experiment rather than the team’s task application: Work was imprecise, Projects was buried, Today was a dashboard-like stack, the board and list were separate experiences, and retired products remained reachable through a build flag.

**Decision:**

1. **Three destinations:** Today, Tasks and Projects. “Work” is renamed to Tasks in routes, labels and copy. Reading pages keep their narrow width; Tasks keeps the wide board/table layout.
2. **Tasks is one workspace with two presentations.** A URL-backed board/table switch (`/tasks?layout=board|table`) shares one filter model, task detail and mutation services. The last presentation is remembered per user. Table uses server pagination and sorting over the full filtered set; board keeps independent lane paging.
3. **One Filters surface.** Project, owner (including Assigned to me), status, priority, exceptions and one Include-canceled control are draft-only until Apply. Chips remove criteria; Clear filters preserves layout, search and selection. The standalone project dropdown and Project settings action are removed.
4. **Today is a pre-meeting check-in table.** The server defines relevance and the change boundary (previous completed standup end, else start of the business day), returns paginated task rows with exception context, and a secondary table for taskless/closed-task commitments. Inline note+status saves reuse the atomic update operation. General notes remain optional and distinct. Recently completed work is a disclosure, not a default list.
5. **Projects is a primary destination.** Searchable project table, authorized/viewer-scoped counts, project detail with owner/member permissions, and View tasks that preserves the chosen presentation.
6. **Ad hoc is a real, idempotently provisioned project.** It is identified by `system_key = 'ad_hoc'` (migration), not repeated name matching. A single legacy project literally named “Ad hoc” is adopted once; duplicates require deliberate reconciliation. The designated project cannot be archived; membership reconciles active users; task authorization remains per-task.
7. **The account control is a real menu.** Name/email/role and authentication context, keyboard navigation, Escape/outside dismissal and focus return. No identity switcher, fake sign-out, notifications or preferences.
8. **Retire the pilot surfaces from the active product.** Intake, transcript review, the legacy board and the Pilot tools menu are removed: routes/components are not registered, `/ai` and `/intake` show a retired notice, old board URLs redirect to Tasks Board, AI/intake API routers are unregistered, the transcript event source mapping is disabled by default and the worker ignores messages. Historical records and migrations are retained; no automatic conversion or data deletion.
9. **Fixed local identity until Cognito.** Local development opens as Maya Chen; production identity comes from nex SSO. Browser tests may override the dev header identity out of band via local storage.

**Supersedes:** the navigation/list/pilot parts of ADR-015 (“Work” as a list, pilot tools) and ADR-017 (“Work is Kanban”, retain legacy board as fallback). ADR-016 trust behavior and ADR-018 brand remain in force. The domain rule that blockers are independent of status (ADR-004) and optimistic concurrency remain unchanged.

**Consequences:**

- Old URLs are normalized/redirected; shared links and browser history continue to work.
- Ad hoc requires a nullable `projects.system_key` migration; startup and Projects reads provision it lazily with savepoint-protected races.
- Retained S3/SQS/Lambda resources still exist in Terraform; retirement requires a separate approved cleanup. No destructive apply is part of this change.
- Manual board rank, touch drag and Cognito/SSO integration remain explicit follow-ups.
- Tests and screenshots move to Today/Tasks/Projects; the browser smoke covers the new shell, filter parity, inline editing, Ad hoc, Projects, standups, retired routes and narrow layouts.

**Status:** Implemented; pilot validation and formal accessibility review remain.


---

## ADR-020 — Tasks-led shell, unified To Do, and an ephemeral standup

**Context:** After the Today/Tasks/Projects handoff, the team found the extra Today destination and the historical standup surface heavier than the daily job. The board also exposed Backlog and To Do as separate columns even though the team treats them as one queue, and the standup entry points had several labels (Start/Resume/View outcomes) and a history/outcomes page.

**Decision:**

1. **Two primary destinations:** Tasks and Projects. `/` redirects to `/tasks`; there is no Today page or navigation item.
2. **One unified To Do category.** The UI groups stored `backlog` and `todo` tasks under a single gray **To Do** lane/status. Backlog remains a valid stored status for legacy data but has no separate lane, status option, or filter option. New tasks use To Do. Board lanes are To Do, In Progress, Done (plus Canceled on request). Table status choices are To Do, In Progress, Done, Canceled.
3. **One Standup button.** The Tasks header has a single manager **Standup** button. It starts today’s session when none exists and otherwise opens the current session. There is no Start/Resume/New/View-outcomes copy. A completed session opens the same view read-only.
4. **No past standups.** The standup list page, outcomes page, history/carry-forward UI and their API routes are removed. `/standups` and `/standups/:id` redirect to Tasks. Session detail/workspace and live capture endpoints remain for the active meeting; historical rows remain retained in the database/audit. Finishing returns directly to Tasks.
5. **Fast in/out.** The standup header offers **Back to Tasks**; there is no global nav in focused mode. The manager can move between Tasks and the standup in one action. Leaving the standup is immediate; there is no leave-confirmation prompt.
6. **Board/card polish.** The keyboard move handle moves out of the owner row so the owner avatar/name aligns with the task title and public ID. The update dialog labels its field **Add update**, uses the card font size for the status picker, and the async Save button no longer reserves an empty leading icon slot. Save update is enabled for progress or status; status-only saves use the version-checked task patch instead of an empty update. Blocked by is a task field edited in the Task card or task creation form, not on updates; the Table shows it read-only.
7. **Updated tests/docs.** Browser and backend coverage follow the retained active surface; removed history endpoints are asserted inactive.

**Consequences:**

- Legacy backlog rows display as To Do and are included in To Do lane/table queries; submitting the same To Do state does not rewrite their stored status.
- Historical session/outcome data is retained but not browsable through the product. Any export/reporting need requires a separate deliberate endpoint/design.
- The focused standup remains manager-only; employees reach their work through Tasks.
- Manual board rank, touch drag and Cognito integration remain deferred.

**Status:** Implemented; validation still pending.


---

## ADR-021 — Projects is task context, not a destination

**Context:** The Projects page duplicated the task workspace. Users reach project-scoped work through the Tasks project filter; the separate destination, detail drawer and member-management UI added navigation weight without a daily job. Team members still need to create projects and filter tasks by them, and project data remains an authorization boundary.

**Decision:**

1. **Remove the Projects destination.** Delete the Projects page, project detail, member-management UI and the primary navigation item. Keep the app header/navigation bar structure with the Tasks slot so a future page can be added without rebuilding the shell.
2. **Keep project context in Tasks.** The existing Project filter continues to scope Board and Table queries and appears as a removable filter chip. `/projects` and `/settings/projects` redirect to `/tasks`.
3. **Create projects from Tasks.** A small, manager-only **New project** button in the Tasks header opens a focused dialog for name, description, owner and members. Successful creation refreshes the filter options and offers a **Filter** action.
4. **Retain the project entity and APIs.** Project list/create (and the existing retention of detail/edit endpoints) remain server-side for filtering, task creation, Ad hoc provisioning and future surfaces. No project or task data is deleted.
5. **Keep Ad hoc.** The idempotently provisioned **Ad hoc** project remains the visible default for global task creation and a valid filter path.

**Consequences:**

- Navigation has one destination today; the nav bar is intentionally retained for future pages.
- Project editing/member management has no active UI. Existing API contracts remain available until a future deliberate design change.
- The manager-only create dialog is the only project mutation surface; employees see the project filter but not project creation.
- Browser coverage replaces the old Projects detail/View tasks journey with project creation from Tasks and asserts no Projects heading/nav remains.

**Status:** Implemented.

---

## ADR-022 — Standup density and task-creation context

**Context:** The standup repeated owner and status on every task row even though the selected participant and group heading already supplied both. A separate “Current work” heading and a differently styled Done disclosure added visual noise. The Tasks owner filter also lacked one of the most common queues — unassigned work — and a Description entered during task creation was stored on a field with no active reading surface.

**Decision:**

1. **Unassigned owner filter.** The manager Owner filter includes **Unassigned**, represented with the same neutral dashed-person icon as unassigned task ownership. The API accepts `assignee_id=unassigned` and returns only tasks whose assignee is null.
2. **Standup rows are contextual.** Remove the repeated owner/status line from every standup task row. The person selector identifies the owner; the In Progress / To Do / Blocked / Done group identifies the status.
3. **Done matches the group pattern.** Done uses the same heading/count treatment and task-card list as the other groups, but starts collapsed. Expanding reveals completed work; nothing is hidden behind a separate “Current work” heading.
4. **Description becomes the first update.** When a task is created with a Description, the backend also inserts a task update authored by the creator in the same transaction. It appears immediately in Latest update, task history and the standup. The task description field is retained for API clients, but the update is the active reading surface.
5. **Helper copy.** The create dialog states that Description is saved as the first update.

**Consequences:**

- The owner filter can produce an empty result without implying an error; the empty state is the normal “No tasks match these filters.”
- The initial update is appended atomically with task creation and audited as `task.update_added`; a failed create writes neither.
- Legacy tasks with descriptions but no updates do not gain backfilled history; only new task creation is affected.
- The standup page is shorter and its Done section remains available without dominating the review.

**Status:** Implemented.

---

## ADR-023 — Priority visibility and task-field editing in the update card

**Context:** Priority affected how work was reviewed but was invisible on the Board and Table. The shared update card exposed only status and Blocked by, so changing an owner or priority meant leaving the card. The New project dialog also carried a description field that was not surfaced anywhere after creation, and its action was visually smaller than Standup and New task.

**Decision:**

1. **Priority is visible in both presentations.** Board cards show a compact priority badge in the top-right; Table gains a dedicated Priority column between Status and Blocked By.
2. **Status, Owner and Priority share one row.** The update card places these controls side by side above Save update. Owner is editable for managers and read-only for employees (who cannot reassign tasks); priority is editable by anyone who can edit the task.
3. **One task patch, then the update.** Owner, priority, Blocked by and a status-only change are bundled into one version-checked Task patch. A progress update remains an append-only record and can carry the status change atomically when no other task field is being patched.
4. **New project stays lightweight.** Remove the project Description input from the New project dialog; the project still has a name, owner and members. The New project action uses the same standard button height and font as Standup and New task.

**Consequences:**

- Priority labels use the existing compact status-like treatment rather than a new chrome-heavy control.
- Owner/priority changes participate in the same 409/load-latest recovery as other task fields.
- Project descriptions remain supported by the project API for existing data/future surfaces, but there is no active authoring field.
- The standard button size keeps the three Tasks header actions visually consistent; mobile uses the same height/font with an icon-only New project label.

**Status:** Implemented.
