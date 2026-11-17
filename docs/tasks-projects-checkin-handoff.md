# Today, Tasks, and Projects — next implementation handoff

## 1. Product decisions

Implement these changes against the current app. This document supersedes conflicting navigation, list-only, board-only, and pilot-tool recommendations in earlier handoffs.

### Navigation

**Today | Tasks | Projects**

- **Today:** prepare for the standup by checking and updating relevant tasks quickly.
- **Tasks:** the complete task workspace, with **Board** and **Table** presentations of the same tasks.
- **Projects:** browse project context and manage projects where authorized.

Rename **Work → Tasks** everywhere in the active user interface. “Tasks” is more precise and immediately understandable; there is no benefit in a more elaborate name.

### Explicit removals

- Remove “Team board,” “My work,” and “N tasks in view” subtitles beneath the Tasks heading. Keep useful lane counts and table pagination, not a replacement decorative summary.
- Remove the standalone All projects dropdown. Project selection belongs in the unified Filters control.
- Remove Project settings from the Tasks toolbar. Projects now has a real home in primary navigation.
- Remove Transcript review, Work intake, Legacy board, and Pilot tools from the active product, including their routes/components and operational entry points—not merely from an expandable menu.
- No “coming soon” AI tile or hidden pilot switch. Future AI-assisted task/description creation is explicitly out of scope.

### Keep what already works

Keep the polished Kanban, tactile controls, task-detail sheet, accessible overlays, draft protection, atomic update flow, version/conflict checks, safe undo, and permissions. Preserve the current **nex Charcoal Neutral** brand in `docs/brand-kit/`; do not revert to the earlier suggested warm/emerald theme.

### Baseline and concurrent work

This handoff was prepared from the working tree after `d65dabc`, including substantial uncommitted board, brand, API, and test work. Treat that working tree as the starting point, not just the last commit. Coordinate with the implementation agent and do not reset or overwrite its changes.

Only this handoff is being added by the reviewing agent. Implementation and validation belong to the receiving agent.

---

## 2. Tasks: Board and Table, one task workspace

### Desktop layout

```text
nex                  Today   Tasks   Projects               [Account v]

Tasks                                                     [+ New task]
[Board | Table]        [Search tasks…                 ]     [Filters · 2]
[Project: Revenue ×] [Owner: Priya ×]                       Clear filters

[Board lanes OR task table]
```

- Board remains the initial default. Remember the last selected presentation per user, with an explicit URL parameter taking precedence.
- The segmented **Board | Table** control changes presentation, not the underlying scope, search, filter semantics, or task state.
- One shared query/filter model feeds both presentations. Do not maintain independent sets of filters or independent task-edit logic.
- Default scope: employees' assigned tasks; managers' authorized team tasks. Offer manager “Assigned to me” and owner selection inside Filters rather than another permanent Team/My work toolbar.
- Preserve other authorized task access paths where the current product supports them. Never confuse “accessible to me” with “assigned to me.”
- Changing layout retains project, owner, status, exceptions, search, and selected task. Per-view pagination/scroll can reset intentionally when necessary, but changing layout must not broaden the data query.
- Canonical URL: `/tasks?layout=board|table&…`. Do not reuse the old `view` parameter without explicitly normalizing its earlier active/completed/all meaning.

### Table specification

Use a readable, compact table—not a spreadsheet product.

| Column | Default behavior |
|---|---|
| Task | Title opens the shared task sheet; concise exception indicator beneath/alongside it |
| Project | Readable project name; includes Ad hoc |
| Owner | Avatar/name; inline reassignment only when authorized |
| Status | Shared status picker; saves immediately with version protection |
| Due | Clear date/overdue wording; compact authorized editor |
| Latest update | Short progress excerpt and timestamp; expand or Add update |
| Actions | Low-emphasis menu for remaining task actions |

- Prefer “Add update” in the Latest update cell instead of repeating several buttons in every row.
- Omit or compact redundant owner context in an explicitly personal view; keep owner visible in team mode.
- Keep priority, risk explanation, full descriptions, and history in task details unless needed to explain an exception.
- Provide useful sorting by task title, owner, status, and due date. Sorting must apply to the **entire server-filtered set**, with a stable tie-breaker—not just the currently loaded page. Add only supported sort keys; do not imply sorting works on a column when it does not.
- Default order should be documented and predictable, e.g. due date then stable ID; Today uses its own attention-first order.
- Server-side pagination, initially approximately 25 rows. Board keeps its independent per-lane loading. Never build Table from only the board's currently loaded cards.
- Board and Table must expose the same filtered task universe, including the same canceled-task option. Switching views must not silently exclude backlog or completed work.
- Loading, empty, filtered-empty, partial failure, saving, and conflict states are explicit. Refreshing one task should not blank the table.
- Use real table semantics, column headings, `aria-sort`, keyboard-accessible controls, and a stable sticky header where useful.
- No bulk editing, row-selection checkboxes, column builder, export system, or spreadsheet keyboard model in this release.

### View consistency

- Moving a task on Board updates its Table state, counts, Today state, and open detail sheet.
- Editing in Table updates its board placement when returning to Board.
- Invalidate/reconcile affected queries after mutations. Handle in-flight replies and identity changes without showing stale data under a new filter/user.
- Status changes must not close unrelated blockers or follow-ups.
- On 409, retain user input and offer current-state recovery. Do not reuse a refreshed version to overwrite newer data automatically.

---

## 3. One unified Filters experience

**Replace both the standalone All projects dropdown and the existing separate filter form with one control.**

### Trigger and surface

- A single **Filters** button with an active-filter count.
- Desktop: a well-sized anchored popover/panel using the current elevated surface style; mobile: an accessible sheet.
- Project is the first field, with searchable selection and All projects as its unselected state.
- Remaining fields: owner/scope where authorized, status, needs help, overdue, and priority under secondary options if retained.
- Include canceled work through a clearly labeled option that has identical meaning in Board and Table. Avoid two contradictory controls for the same status rule.
- Use draft selection with **Apply** and **Reset filters**. Cancel/Escape closes without applying partial changes. Clicking Apply commits the whole filter state once.
- “Assigned to me” is a shortcut to the owner criterion, not a second contradictory scope filter. Selecting a specific owner clears/confirms replacement of that shortcut.
- Show applied filters as removable chips beneath the toolbar. Clicking a chip label opens the matching filter section; its remove button clears that criterion immediately.
- **Clear filters** preserves layout, search, selected task, and user authorization scope. Search has its own clear action. Avoid the current ambiguous “clear everything” behavior.
- Resetting optional status filters returns to the documented default status scope; it does not change permissions or include canceled items unexpectedly.

### State and links

- URL is the source of truth for committed filters. Browser Back/Forward and shared project links reproduce the same result.
- Opening a task from filtered results preserves the result context when it closes.
- Changing filters resets/clamps relevant page offsets and cancels a drag safely. Do not submit a card move using stale query state.
- Filter option failures show Retry rather than pretending no projects/users exist.
- Defaults inherent to the role do not inflate the active-filter badge. A manager explicitly choosing Assigned to me does count.

---

## 4. Projects becomes a natural destination

### Purpose

Projects organize tasks and ownership; they are not a settings category buried in Filters.

```text
Projects                                                  [+ New project]
[Search projects…]                              [Active | All]

Project                 Owner           Status        Open tasks
Ad hoc                  Maya            Active        7
Revenue reporting       Priya           Active        12
Marketing attribution   Dana            Active        5
```

- Use a concise project table/list rather than restoring dense metric cards and progress charts.
- Show project name, brief description where useful, owner, status, and authorized task count. Keep members and administrative actions in details.
- Project name opens a project detail surface with overview, owner, members, and permitted edits.
- A clear **View tasks** action opens `/tasks?project=<id>` with the project filter applied; preserve the user's chosen Board/Table presentation where practical.
- All roles get the Projects tab, but only see authorized projects. Creation, membership management, archival, and editing obey existing backend capabilities.
- Project owners may have different permissions from ordinary employees; do not hide every administrative action solely because a user is not a manager.
- Remove “Project settings” terminology and “Reachable from Work” explanatory copy.
- Archived projects remain accessible through All or a secondary status filter. Historical tasks are not deleted when a project is archived.
- Counts must reflect a clearly defined authorized scope. Do not reveal restricted task metadata/counts unintentionally through this new prominent destination.

### Ad hoc: ordinary work without an intake process

Create one stable, real **Ad hoc** project for work that does not belong to a named initiative.

- Use the existing task creation flow. No request/review/accept/convert state machine.
- Global New task defaults visibly to Ad hoc when no specific project context is selected. An explicit project filter or project-detail context takes precedence.
- The project field remains visible and changeable; never hide the fact that the task is being placed in Ad hoc.
- A lane's New task retains its target status as well as the safe project default.
- Ad hoc is a real project reference, not a null project, a magic display string, or a second task type.
- Provision it idempotently for existing installations as well as fresh setups. A demo seed alone is insufficient. Use a stable identifier/system key or equivalent designated reference, not repeated case-sensitive name matching.
- Handle an existing suitable Ad hoc project without creating duplicates. If multiple candidates exist, require an explicit migration choice rather than silently merging data.
- Configure intended team access through the existing authorization model. Do not make every Ad hoc task globally readable just because the project is shared. Do not assign an employee as universal project owner as a workaround.
- Ensure newly provisioned authorized employees can use the intended Ad hoc path; test both project visibility and task-creation permissions.
- Keep Ad hoc available as the default project; guard archival/deletion while it is designated as the default. Future replacement is a controlled configuration/migration operation, not an extra settings screen now.
- If Ad hoc is unavailable or options fail to load, show a recoverable state; do not select an unrelated first project.

**Acceptance:** creating a small unplanned task requires title, an appropriate owner, and one save. It appears under Ad hoc in both Tasks views and in Today when relevant.

---

## 5. Today becomes a pre-meeting check-in workspace

### The natural daily loop

1. Open Today before the standup.
2. Scan relevant tasks and their latest updates.
3. Change status, add a short progress note, or ask for help in place.
4. Leave; the manager sees the same records during standup.

There is no separate “submit my standup,” duplicate daily report, mandatory check-in, or automatic “ready” declaration. Task records are the source of truth.

### Layout

```text
Today · Friday, Nov 13                        [Past standups] [Start standup]
A quick check before your standup.

[Search today's tasks…]                                     [Filters]

Task / Project          Owner*    Status       Latest update       Due / Help
Revenue reconciliation  Priya     In progress  Checked totals…     Today
                                               [Add update]
Attribution model       Jordan    In progress  Waiting on access   Needs help
                                               [Add update]

[View all tasks →]

Other follow-ups and help requests          (only when items exist)
[Compact actionable table of commitments not represented above]

[Add a general note]                         [Ask for help]
```

`*` Owner is essential in the manager/team view; it can be omitted in the employee's assigned-only view.

### Header

- Show the business date and a short purpose statement, not metrics.
- Managers get Start / Resume / View outcomes based on session state. Disable/hide misleading actions until session state is known.
- Employees get a small accurate session-state message or outcomes link, not a manager control.
- Keep Past standups secondary and findable.
- Today remains usable before a session exists, while it is live, and after it ends. Later task changes do not rewrite what was recorded in a completed meeting.

### The table is the main content

Replace the current separate attention cards, current-work list, and large update composer with **one deduplicated task table**.

- Employees: their assigned tasks relevant to the next/current standup.
- Managers: relevant authorized team tasks, including their own. Owner filtering supports a quick person-by-person pre-meeting scan; do not require entering the live meeting to inspect current work.
- Keep the manager's owner filter inside the same unified Filters pattern; no “Team board” heading or repeated scope toolbar.
- Default sort: needs-help/overdue/risk items first, then current/upcoming work, with stable tie-breaks. A task with several reasons appears once, with expandable issue details.
- A recent progress note remains visible as content with its timestamp and attribution. Do not replace it with a vague “Updated” badge.
- “No update yet” is neutral. No red compliance indicators, employee readiness scores, or compulsory daily clicks.
- Clicking the task opens the same task sheet used in Board/Table, preserving Today context.

### Explicit relevance rules

Define the query centrally on the server, not by filtering a six-task preview in the browser. Recommended default:

1. Nonclosed tasks with open blockers, overdue dates, explicit risk, or open follow-ups.
2. Tasks in progress.
3. To-do tasks due within the existing configured upcoming-work horizon, plus newly assigned/created active tasks since the relevant previous standup boundary.
4. Recently completed work since the previous completed standup, available through a small **Recently completed** disclosure or scope option rather than crowding the initial table.

Use the previous completed standup's end time as the change boundary; when there is no prior session, use the documented business-day boundary. Establish actual assignment/status-change times from available events or explicit fields, not generic `updated_at` as a claim that a task was newly assigned/completed.

- Show the actual cutoff/date when displaying “since last standup.” A task still Done from months ago is not a recent completion.
- Do not show the full backlog by default. All tasks remain reachable in Tasks.
- Closed tasks with unresolved commitments must not make those commitments disappear; show those commitments in the compact secondary area if the task itself is outside the main query.
- Queries are fully paginated, permission-scoped, and deterministic. Do not hide older attention items behind hard-coded 6/10/200 limits.
- If the desired event-based criteria require API work, implement/document it rather than displaying misleading labels backed by a heuristic.

### Fast editing, not a spreadsheet

- Status: shared picker, immediate version-checked save.
- Add update: expands one small row editor with a short text field, optional status change, and Save update. Use the existing atomic/idempotent progress-plus-status operation.
- Keep one expanded editor at a time; switching rows protects unsaved input. No modal just to type a sentence unless required on a narrow screen.
- Owner/due date: compact authorized editors where relevant, using the same mutation logic as Tasks Table.
- Needs help: visible existing issue opens its details/resolution; Ask for help creates a durable blocker, not only a note. Avoid encouraging duplicates when an unresolved request already exists.
- After saving, show the server-confirmed note and timestamp. Preserve focus and row position long enough to make the result clear; then reconcile sort/filter changes without a jarring full-page reload.
- An off-screen mutation failure remains recoverable with its draft; a temporary toast alone is not enough.
- No bulk Save all, editable blank rows, formulas, or compulsory checkboxes.

### Taskless commitments and general notes

- Keep a small **Other follow-ups and help requests** table only when there are relevant items not already represented in task rows: taskless requests, commitments the user owns on other work, and unresolved items on closed tasks.
- Preserve the user's right to see/resolve their own commitment without leaking restricted linked task details. Backend visibility checks remain authoritative.
- Show description, responsible person, due/age, and the permitted action. A visible completion must update the underlying commitment, not merely hide the row.
- Keep **Ask for help** available with zero tasks.
- Keep existing general daily notes/history, but put creation/editing behind **Add a general note**. This is optional extra context, not another required report. Preserve the distinction from task updates and append-only corrections.

### Tie Today directly to Tasks

Today is a purpose-specific projection of the same task entities, not a parallel store or review workflow.

- Shared row controls, sheet, update composer, capability handling, and mutation services.
- Updating a record from Today refreshes Tasks, the manager's current view, and the live meeting on safe refresh triggers.
- **View all tasks** opens Tasks Table with the current owner/project context carried over, but deliberately removes Today's relevance restriction. The user should understand that they are now browsing all matching tasks.
- Returning to Today restores its position/context without retaining another user's private state after identity changes.
- Do not write artificial task updates to indicate that someone merely opened or looked at Today.

---

## 6. Polish the top-right identity control

The current avatar/name/role block should become one compact, intentional **account menu**, not a static annotation.

### Trigger

- Desktop: 32–36px avatar, readable name, subtle chevron in one keyboard-focusable button.
- Role can move into the open menu instead of occupying a permanent second header line.
- On small screens, avatar plus accessible account label is enough. Keep Today, Tasks, and Projects reachable without collisions or tiny text.
- Use a restrained charcoal surface/hover treatment aligned with the current header brand; do not add a bright pill competing with New task.
- No hard-coded fallback identity such as “Maya Chen” or “manager.” Unknown/loading identity gets a neutral placeholder; auth failure gets the actual recovery flow.

### Menu

- Signed-in name and email, role, and accurate authentication context (e.g. Signed in through nex).
- Only include real supported actions. Do not invent profile editing, notifications, preferences, or fake sign-out functionality to fill the menu.
- Show Sign out only when the actual authentication provider has a supported flow; otherwise provide the appropriate existing portal/session link if available, or a purely informational account menu.
- Do not reintroduce production role impersonation or the removed identity switcher. Any existing development-only testing mechanism remains explicitly isolated from ordinary account UI.
- Correct menu semantics, keyboard opening/navigation, Escape/outside dismissal, focus return, and no clipping at the viewport edge.

---

## 7. Remove obsolete areas cleanly

Removal means they cannot be enabled accidentally by `DEV` or `VITE_ENABLE_PILOT`. It does **not** authorize destroying historical data.

| Area | Remove now | Preserve / future handling |
|---|---|---|
| Transcript review | Review/upload UI, imports, routes, session Import transcript links, AI API registration, active job-enqueue/worker entry paths | Existing transcripts, proposals, and audit data under retention policy. Future AI task drafting is a separate design; do not build it now |
| Work intake | Intake UI, routes, API registration, create/review/convert workflow, active navigation/copy | Existing requests and conversion links. Inventory unresolved requests and document any deliberate manual transition to ordinary tasks; no automatic silent conversion |
| Legacy board | `Board.tsx` and its private obsolete editor/create code; pilot link/feature gate | Existing task data. Old board URLs redirect to current Tasks Board |
| Pilot tools | Menu, `PILOT_ENABLED` wiring, obsolete environment/config/docs references and obsolete tests | No hidden replacement menu or generic More menu full of retired products |

### Runtime and infrastructure boundaries

- Remove obsolete active frontend/API code and dependencies where they are no longer shared. Keep audit/history models needed for retained data; don't edit old applied migrations or drop tables as part of UI cleanup.
- Retain reference implementation in version history rather than shipping a disabled future AI product inside the active frontend bundle.
- Inventory scheduled/queued transcript work. Ensure new upload/processing work cannot continue simply because API routes disappeared; update runtime/deployment configuration to disable consumption/enqueue as appropriate.
- Prepare infrastructure cleanup changes carefully. **Do not run a destructive Terraform apply, delete buckets, purge queues, or delete retained transcripts without an explicit operational approval/retention plan.** Report the remaining deployed resources and manual retirement steps.
- Existing approved/applied AI changes remain valid task history; retiring the feature must not undo them.
- No background conversion of old intake requests to Ad hoc tasks. Reconcile intentionally and preserve original provenance if a request is later converted by an authorized process.

### Old links

| Old URL | Result |
|---|---|
| `/work` with valid query context | Redirect to `/tasks`, preserving supported layout/project/search/owner/task context |
| `/board`, `/legacy/board` | Redirect to `/tasks?layout=board`, preserving supported filters/task context |
| `/settings/projects` | Redirect to `/projects` |
| `/projects` | Canonical Projects page, no settings redirect |
| `/ai`, `/intake` | Nonfunctional retired/not-found page with a clear route back to Today or Tasks; do not reopen functionality or silently imply task conversion |

This brief intentionally supersedes the prior instruction to retain the legacy board as a pilot fallback.

---

## 8. Implementation seams and sequencing

### Increment 1 — Shared query state and navigation

- Rename Work to Tasks in routes, page/component names where sensible, labels, search placeholders, deep links, and docs. Domain uses of “work” in natural prose need not be mechanically replaced.
- Add Projects navigation and remove the Tasks settings button/subtitle.
- Implement one filter model/control, URL normalization, and Board/Table presentation state.
- Preserve the current board implementation; extract data/mutation logic rather than duplicating it in Table.

### Increment 2 — Table and shared task interactions

- Build a semantic `TaskTable` with reusable row controls and the shared task sheet.
- Add server-paginated/sorted table queries with the same authorization/filter semantics as the board's lane queries.
- Ensure per-task pending states, version recovery, and cache invalidation work across all presentations.
- Extend existing Playwright coverage instead of replacing the testing setup.

### Increment 3 — Projects and Ad hoc

- Convert `Projects.tsx` from administrative cards into a project destination with details and View tasks.
- Provision Ad hoc idempotently and safely for fresh and existing installations, including permissions/new-user access.
- Connect contextual/default task creation and test manager/employee behavior.

### Increment 4 — Today check-in table

- Replace the current multi-section attention/current-work/composer layout with the main check-in table and conditional secondary commitments area.
- Extend `backend/app/services/today.py`, `attention.py`, Today schemas/APIs, and shared query logic as needed for complete role-aware, relevant, paginated task data.
- Do not merge the existing limited `attention` and `current_work` responses client-side and call that the full check-in list. They have different entity/owner semantics; attention owner can be the helper rather than the task assignee.
- Add an explicit task assignee versus help/follow-up owner distinction in the presentation model.
- Reuse the same task update/status operations as Tasks; do not add another standup-submission API.

### Increment 5 — Retire obsolete product surfaces and finish account UI

- Remove active legacy/intake/transcript/pilot wiring and clean build/deployment entry points.
- Implement the account menu without auth invention or identity fallbacks.
- Refresh documentation/screenshots and report any operational retirement tasks requiring separate approval.

## 9. Acceptance checklist

### Product structure

- [ ] Header contains Today, Tasks, Projects, and the polished account control; no Pilot tools.
- [ ] No “Team board,” “My work,” “tasks in view,” or Project settings action under Tasks.
- [ ] Exactly one project-filter entry point: unified Filters, plus its applied chip.
- [ ] Tasks offers Board and Table with the same effective filter universe.
- [ ] Projects is a meaningful destination, not a renamed settings header over unchanged dense cards.

### Table / filters / state

- [ ] Board → Table → Board preserves search/project/owner/status filters and selection.
- [ ] Table loads the full filtered result through server pagination, not only loaded board cards.
- [ ] Sorting applies to all matching rows; ties and pagination are stable.
- [ ] Canceling filter edits changes nothing; Apply commits once; Clear filters preserves search/layout.
- [ ] Edits reconcile Board, Table, Today, task details, and live standup without stale-context writes.
- [ ] Direct links and browser Back/Forward preserve predictable query/detail state.

### Today

- [ ] Employee and manager can scan and update relevant tasks before any standup session exists.
- [ ] A task with several exceptions appears once; responsible helper and task owner are not confused.
- [ ] One sentence plus Save updates the actual task; no second daily submission required.
- [ ] The relevance query and “since last standup” labels match actual server data/time boundaries.
- [ ] Recently completed work and all other tasks are reachable without filling the default table with backlog/history.
- [ ] Taskless/closed-task commitments and zero-task help requests remain accessible.
- [ ] General notes are optional, secondary, and never overwrite task progress history.
- [ ] Drafts survive errors; switching rows/routes requires preservation or explicit discard.

### Ad hoc / permissions / removal

- [ ] Fresh setup and existing installation each get exactly one designated usable Ad hoc project.
- [ ] Ordinary new tasks default visibly to Ad hoc; explicit project/lane context wins.
- [ ] Shared Ad hoc membership does not expose every task to every employee.
- [ ] Unauthorized reassignment/project administration remains blocked server-side.
- [ ] No frontend build mode re-enables Transcript review, Work intake, or Legacy board.
- [ ] Removed API routes and worker entry points are verified inactive; retained records remain intact.
- [ ] No unintended cloud/data deletion is included in automated validation.

### Polish / verification

- [ ] Account identity is real; no default person/role or nonfunctional menu actions.
- [ ] Keyboard and screen-reader smoke tests cover tables, filters, inline editors, menus, and sheets.
- [ ] At 375px / 768px / 1280px / 1440px and 200% zoom, navigation and actions remain reachable. Tables can use a deliberately bounded scroll region or a narrow row-detail presentation; do not hide status/update actions to fit.
- [ ] Slow loads, empty results, failed options, double-submit, stale versions, response loss, and identity changes are tested.
- [ ] Backend tests/lint and frontend build/typecheck/browser tests pass; results are reported accurately.
- [ ] Screenshots include employee Today, manager Today, both Tasks views, unified Filters, Projects, account menu, and a narrow-screen check-in edit.

## End state

**Today prepares the conversation. Tasks holds the work in Board or Table. Projects provides context.**

Everything else should either support that flow directly or leave the product. The result should feel like one coherent task-management application, not several experiments collected behind a Pilot menu.
