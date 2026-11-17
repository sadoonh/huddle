# Pilot checklist — Tasks and Standup

Use this for the two-week validation of the current product: **Tasks holds the work in Board or Table, with project filtering and a small project creator. A single Standup button gives the manager a focused view and a quick way back.**

## 1. Before the pilot

Record a baseline (last 2–4 weeks where available):

- Standup duration.
- Time spent after the meeting writing up updates/actions.
- Carry-forward blockers/follow-ups older than 3 days.
- Action items without an owner.
- How often someone says “I didn’t know that changed.”
- Where people currently look first (tracker, notes, chat).

Do not collect transcript or note contents for this experiment. Aggregate counts/timings are enough.

## 2. Participants and devices

- One facilitator (manager) and 2–5 employees.
- At least one laptop session and one narrow/mobile-width session.
- At least one keyboard-only pass through Tasks, the update dialog and the standup.
- A fresh database (`make seed`) and an existing local database (launcher schema update) to prove Ad hoc provisioning.

## 3. Required scenarios

| # | Scenario | Pass condition |
|---|---|---|
| 1 | Manager opens Tasks | Board/Table share project/owner/status/search filters; last presentation is remembered |
| 2 | To Do category | Backlog and todo tasks appear together under **To Do** with the gray backlog dot; no separate Backlog lane or status option |
| 3 | Board card | Owner avatar/name aligns with the task title and public ID; priority is visible top-right; drag/keyboard move works |
| 4 | Table | Priority column is present; status picker offers To Do / In Progress / Done / Canceled, saves with version protection and Undo |
| 5 | Update dialog | Field label says **Add update**; Status, Owner and Priority sit together above Save update; Save update has symmetric padding |
| 6 | Filters | Draft until Apply; Escape changes nothing; chips remove criteria; Clear filters keeps layout/search |
| 7 | Global New task | Project defaults visibly to **Ad hoc**; explicit project context wins; a Description becomes the task's first update |
| 8 | Project filter + create | Filter scopes Board/Table to one project; the manager's small **New project** dialog creates a project and refreshes filter options; no Projects tab or page remains |
| 9 | Standup entry | Tasks has one **Standup** button; no Start/Resume/New/View outcomes wording |
| 10 | Standup view | Manager layout shows In Progress / To Do / Blocked and a collapsed Done; rows omit repeated owner/status and there is no Current work heading |
| 11 | Standup exit | **Back to Tasks** and **Finish standup** return directly to Tasks without a leave confirmation; completed view is read-only |
| 12 | Past standups | No Past standups page/link, no outcomes page, `/standups` and `/standups/:id` redirect to Tasks; historical APIs return no data |
| 13 | Stale edit | `409` retains input and offers latest-state recovery; no silent overwrite |
| 14 | Read-only work | No movement controls; direct API attempt is forbidden |
| 15 | Legacy links | `/work`, `/board`, `/legacy/board`, `/projects`, `/settings/projects` redirect; `/ai` and `/intake` are retired notices |
| 16 | Account menu | Real identity/context; keyboard/Escape/focus return; no fake actions or identity switcher |
| 17 | Narrow width | Navigation reachable; one board lane; bounded table scroll; no document-wide overflow |
| 18 | Retired surfaces | No Pilot tools/nav/feature flag re-enables intake, transcripts or the legacy board; worker consumes nothing |
| 19 | Browser Back/Forward | Filters, layout, sort, page and open task restore predictably |

Also test a task with several exceptions, an employee with only backlog/completed work, and an old completed task with an unresolved commitment.

## 4. Questions to answer

1. Is the unified To Do category clearer than separate Backlog/To Do lanes?
2. Is Board or Table the default for most people? Does per-user layout memory match expectations?
3. Is the single Standup button discoverable and fast enough to enter/leave during a meeting?
4. Are the update dialog's labels, status picker and save button comfortable at a glance?
5. Do any retained history/transcript records need a documented manual transition path?

Do not delete historical requests, transcripts, proposals or audit data as part of this decision. Use a read-only/export/retention path.

## 5. Exit criteria

The current experience can replace the previous tools when:

- The 19 scenarios pass on laptop and narrow widths.
- No critical data-integrity regression is observed.
- Facilitators can enter and leave the standup without losing context.
- Employees do not report re-entering information.
- Outstanding commitments remain visible in Tasks and the standup.
- Any manual retirement of retained cloud/history resources has an approved plan.

If a target fails, fix the flow before restoring a retired surface. Do not re-add Pilot tools or a past-standups archive as a shortcut.
