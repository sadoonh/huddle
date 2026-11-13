# Product simplification plan

> **Implementation status:** Phases 1–3 are implemented in the current codebase (Today + Work navigation, focused meeting, daily updates, durable help, outcome-first history, pilot-gated tools). Phase 4 destructive removals are deliberately deferred pending the pilot in [pilot-checklist.md](pilot-checklist.md). ADR-015 records the simplification; ADR-016 records the follow-up trust/interaction polish (atomic saves, retry ids, draft guards, accessible overlays, URL-backed Work, business date).

## Recommendation

**Make this a daily work-and-standup tool, not a small project-management suite.**

The product should answer three questions:

1. What needs my attention?
2. What changed?
3. Who is doing what next?

Keep the underlying accountability. Remove the requirement to navigate, classify, and administer everything to get that accountability.

### Review basis and limits

This review inspected the current React routes, page/component implementations, relevant backend contracts and permissions, product documentation, and the checked-in live-standup, employee, and summary screenshots. It did not run a fresh browser session or observe actual users. Screenshots are supporting evidence; current source is the implementation reference.

There is no usage evidence in this review establishing that intake, Kanban, or transcript processing is unused. Their proposed removal from the default experience is a product recommendation, not a measured finding. Pilot it before deleting capabilities or data.

Working assumption: this is a team whose main need is lightweight daily coordination, consistent with the README and ADR-001. If intake approval is a mandatory business control, retain it as a contextual workflow rather than bypassing it.

## 1. What is creating the clutter

| Finding | Current evidence | Consequence |
|---|---|---|
| Too many equally prominent products | `Layout.tsx` has seven manager navigation destinations and five employee destinations | Users must understand the application's organization before doing their work |
| Today is an overview rather than a focused action surface | `Dashboard.tsx` combines session information, personal work, team pulse, blocker/follow-up lists, carry-forward, and recent history | The next action competes with summaries and repeated facts |
| Employee reporting has two layers | `PreMeetingCard.tsx` asks for overall progress, next steps, blockers, and optional task-specific progress/next steps | Users can report the same change twice; even optional fields create perceived work |
| The primary meeting screen splits attention four ways | Global sidebar plus participant panel, task panel, and permanent capture panel | Facilitation requires scanning between navigation, evidence, and forms |
| Classification precedes capture | `MeetingCapture.tsx` exposes Progress, Action, Decision, Blocker, and Note tabs | The facilitator must choose a record type while listening |
| Important information appears repeatedly | Task status plus reason badges; carry-forward plus task details; review progress in two places; Complete in two places | More visual objects without more useful information |
| Follow-up has two meanings | Participant follow-up flag/note and owned action items | A flag can look like a commitment without equivalent ownership/completion behavior |
| Home shows work but cannot act on it | `Dashboard.tsx` task rows are read-only; editing requires the board | Users see a problem, then must relocate it to fix it |
| Routine metadata dominates | Priority/status/date/project badges, color-coded borders, 9–11px supporting text | Dense screens are made smaller instead of genuinely simpler |
| History emphasizes bookkeeping | `Session.tsx` shows a counts-based summary, count tiles, captured records, participant details, and session facts | Readers must reconstruct the actual outcomes |
| Peripheral workflows have substantial overhead | Five-column board; intake review/conversion states; AI proposal JSON and separate approval/application | The suite asks for more administration than the core job requires |

A specific example: the live screenshot shows “In Progress” twice on the same active task. It also presents two Complete buttons and two review progress bars. These are safe first cuts.

## 2. Define the smaller product

### Daily navigation: two destinations

- **Today:** personal action queue for employees; team attention queue and standup entry for managers.
- **Work:** searchable task list. Defaults to personal work for employees and team work for managers, always within existing permissions.

Secondary access:

- **Past standups:** a link from Today and session summaries, not a permanent primary destination.
- **Project settings:** contextual to the selected project in Work, for authorized users.
- **Transcript import:** off by default; if retained, available from a session's secondary actions.

The live meeting is a focused mode entered from Today, not a competing top-level product. Replace the persistent wide sidebar with compact navigation; hide it during the meeting and provide a clear exit.

Do not move every removed feature into a large “More” menu. Some features should actually leave the default product.

### Feature decisions

| Capability | Decision | Destination / treatment |
|---|---|---|
| Task title, owner, status | Keep | Core work row and task detail |
| Due dates | Keep, optional | Show prominently when due soon or overdue |
| Progress updates | Keep, simplify | One short update; no mandatory daily essay |
| Blockers | Keep | “Needs help”; retain owner, resolution, and carry-forward |
| Follow-ups / action items | Keep | Owned commitments with a Done action |
| Decisions | Keep, secondary | Explicit “Record decision” action and outcome summary |
| Standup start, review, finish | Keep | Focused person-by-person meeting |
| History and audit | Keep, disclose on demand | Outcomes first; full records and audit deeper |
| Team pulse tiles | Remove | Replace counts with an actionable queue |
| Separate carry-forward dashboard | Merge | Show outstanding items once in the attention queue |
| Participant follow-up flag | Retire from new use | Use an owned follow-up instead; preserve old flags in history |
| Mandatory-looking pre-meeting questionnaire | Replace | One optional “Anything changed?” composer |
| Kanban / drag-and-drop | Remove from default product | Simple list and explicit status control; pilot before deleting legacy view |
| Projects overview dashboard | Remove as a destination | Keep projects as task context and authorization boundaries |
| Priority badges on every task | Remove from default rows | Keep existing priority in details initially; show urgent exceptions only if useful |
| At-risk flag | Secondary | Preserve meaning/data; show as a reason for attention, not another always-visible control |
| Work intake | Disable by default | Retain only if a distinct requester/approval workflow is demonstrated |
| AI transcript reconciliation | Disable by default | Opt-in session utility only if it demonstrably saves net time |
| General notes and rationale | Secondary | Optional meeting details; no permanent capture tab |
| Technical IDs, versions, source labels, JSON | Remove from ordinary UI | Diagnostics/audit only; concurrency remains enforced underneath |

**Do not collapse blockers into task status or turn all records into unstructured notes.** That would simplify the screen by destroying the features that make the app valuable.

## 3. The redesigned daily workflows

### A. Employee: open, update if needed, leave

Default Today screen:

```text
Today                                      View all work

Needs attention
  Warehouse access needed          [Needs help] [Open]
  Send reconciliation pack         Due today    [Done]

My current work
  Revenue variance dashboard       In progress  [Update]
  Channel spend ingest             To do        [Update]

[Anything changed?]
```

Rules:

- One column. No recent-history panel, pulse tiles, duplicate task list, or large session-status card.
- Attention items first; current work next. Completed, canceled, and backlog work are accessible through Work rather than displayed by default.
- Default to a short current-work preview with an explicit “View all N” link. Never silently truncate the attention queue: expose its total and a clear continuation when long.
- Clicking Update opens one text field, with the task already selected. Optional status change is adjacent; asking for help is a distinct labeled action.
- A general update is allowed without forcing a task choice. Next steps are optional, not a second required narrative.
- Existing task updates appear in the meeting automatically. Do not require a second standup submission to repeat them.
- No mandatory “No change” submission. Absence of an update must not be interpreted as confirmation that nothing changed.
- After submitting, collapse to a short saved receipt with a way to inspect the saved record. Do not leave the full form consuming the page.
- Status changes and follow-up completion work directly from Today within the user's permissions.

**Important backend gap:** pre-meeting updates currently require an existing session and close when the employee is reviewed. Task-linked updates can use the existing task update endpoint outside a session. General daily updates before a session exists need a small date-scoped persistence contract, or an explicitly narrower first release. Do not silently create/start a meeting on behalf of an employee.

**Important semantic gap:** `submit_pre_meeting` stores blocker text on the participant; that text is not itself a durable Blocker. A new “Needs help” action must explicitly create/link a blocker, or clearly say it is only a note for discussion. It must not falsely promise carry-forward.

### B. Manager: act on exceptions or start the meeting

Today contains:

1. One state-aware action: **Start standup**, **Resume standup**, or **View outcomes**.
2. One team attention queue with the work, person responsible, reason, and next action.
3. A small Past standups link.

Remove manager “My work” from the default home layout; it remains one filter away in Work.

Combine related task exceptions into a single row rather than repeating that task under blocked, overdue, at-risk, and follow-up panels. Show the leading reason and an expandable indication of additional issues. Team-wide blockers and taskless follow-ups still need their own rows; deduplication must not hide them.

Do not equate every open follow-up with an emergency. Prioritize blockers, overdue commitments, explicit risks, then upcoming work. Preserve access to all outstanding commitments.

### C. Live meeting: one person, one main workspace

```text
Standup                 2 of 4 reviewed              [Finish]

[Priya Patel v]
Latest update: Dashboard validation is complete.

Needs attention
  Attribution model v2
  Needs warehouse access — Jordan owns resolution
  [Update] [Needs help] [More]

Current work
  Revenue variance dashboard                     In progress

[Add follow-up]                            [Reviewed & next]
```

Changes:

- Remove the global sidebar in meeting mode.
- Replace the permanent participant column with a compact person selector; expose the full roster on demand.
- Remove the permanent capture column. Open a compact contextual composer beside/below the selected item or in an accessible drawer.
- Keep **Update**, **Needs help**, and **Add follow-up** easy to find. Put Decision and General note under a labeled secondary action.
- Use one text field initially. Reveal owner/due date for follow-ups, and task context only when not already selected.
- Display inferred owner/task context clearly and allow correction. Do not silently guess who can resolve a blocker.
- Keep one review indicator and one Finish action.
- Make Reviewed & next the main navigation action. Do not mark someone reviewed merely because they were viewed or skipped.
- Warn when finishing with unreviewed people. Keep an explicit override without duplicating count tiles and explanatory paragraphs.
- Show the last saved capture briefly, with a link to session records; no permanent activity feed.
- Preserve unsaved text when switching people/tasks; prompt or keep a clearly scoped draft. Never attach a stale task selection to the next participant.

For larger teams, test whether the roster should remain open on wide screens. Start with the smallest default, not a permanent three-panel layout.

### D. Work: a list, not a planning suite

- Default list: task title, owner when useful, status, and relevant due/attention information.
- One search box and one Filters control; no always-visible filter toolbar full of options.
- Common visible states: To do, In progress, Done. Preserve Backlog and Canceled as secondary states/views rather than immediately migrating stored statuses.
- Create task with title and an explicit/defaulted project context; owner defaults to self only where appropriate. Status defaults to To do. Due date and other metadata are optional.
- Never silently choose the first project: projects affect permissions, not just grouping. Require a selection when context is ambiguous.
- Share one task detail/edit experience across Today, Work, and the meeting. Users must not relocate a task to another screen to update it.
- Project setup remains available contextually to project owners/managers with the existing permission rules.

### E. After the meeting: outcomes, not statistics

Default summary sections:

1. **Next actions:** description, owner, due date, completion state.
2. **Unresolved help needed:** blocker, responsible person, linked task.
3. **Decisions:** what was agreed.

Collapse routine progress records, participant reporting, session facts, and audit details behind clearly named links. Hide empty sections.

Keep summaries deterministic; no new AI dependency. Clearly distinguish “recorded in this meeting” from “still open now.” Finishing a meeting must not close commitments, and later resolution must not rewrite historical facts.

## 4. Reduce visual density without hiding essential actions

- One dominant action for the current workflow step. Repeated row actions remain clearly secondary.
- At most one workflow-status indicator and one leading exception indicator per compact task row; disclose remaining reasons on expansion.
- Do not repeat status already communicated by a section heading or another badge.
- Reserve strong color for actionable problems and the primary action. Avoid giving routine priority, project, and metadata equal emphasis.
- Use readable body text, generally 14–16px, instead of fitting more 9–11px content on screen.
- Prefer whitespace and simple rows over nested cards, colored borders, pills, and tiny legends.
- Use ordinary language: “Needs help,” “Next actions,” “Past standups.” Avoid “exception-first,” “carry-forward,” and “structured records” in daily UI copy.
- Retain accessible labels, keyboard operation, visible focus, drawer focus management, and text descriptions of state. Do not replace the clutter with unlabeled icons or hover-only controls.
- Loading/error states must not masquerade as “nothing needs attention.”

## 5. Delivery sequence

### Phase 1 — Subtract duplication and focus navigation

**Scope:** mostly frontend, no destructive data changes.

- Reduce primary navigation to Today and Work; add contextual history/project access.
- Merge the separate standup launch experience into Today; preserve old URLs through redirects.
- Remove home pulse tiles, recent-history panel, and duplicated summaries.
- Remove duplicate Complete controls, progress bars, and repeated task-status badges.
- Collapse/hide completed and backlog work from daily views.
- Feature-gate intake and AI entry points; retain access for any pilot users who require them.

**Files:** `frontend/src/components/Layout.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/Dashboard.tsx`, `TodayStandup.tsx`, `Workspace.tsx`, and workspace components.

**Exit criterion:** a new user can identify their next action without being taught the navigation. No removed entry point strands an essential operation.

### Phase 2 — Make the core actions fast

**Scope:** highest-impact interaction changes; targeted backend work where needed.

- Replace the board's default experience with Work list; extract reusable task detail/create UI from `Board.tsx`.
- Make Today rows actionable.
- Replace the employee questionnaire with the small update/help flow.
- Build the single-workspace meeting layout and contextual capture.
- Use owned follow-ups instead of creating new participant flags.
- Implement correct pre-session update behavior and durable help requests; prevent duplicate writes on retries.
- Use a shared/server-defined attention ordering. The dashboard currently classifies tasks separately from the backend workspace; do not perpetuate inconsistent definitions.
- Query/paginate the full attention set rather than filtering a hard-coded first 200 tasks or first eight blockers/actions and presenting that as complete.

**Files:** `Dashboard.tsx`, `Board.tsx`, `PreMeetingCard.tsx`, `Workspace.tsx`, `components/workspace/*`, `lib/types.ts`, and relevant task/standup schemas/services/APIs.

**Exit criterion:** employee update, blocker capture, follow-up creation/completion, and review-next all work without leaving their current context. Tests cover attribution, permissions, retries, conflicts, and drafts across participant switches.

### Phase 3 — Simplify outcomes and pilot

- Rebuild session summaries around actions, unresolved blockers, and decisions.
- Keep history findable without putting historical detail on every screen.
- Run the simplified experience with one facilitator and a small representative employee group for roughly two working weeks.
- Compare behavior against the current flow; fix missing visibility before deleting the legacy implementation.
- If intake is necessary, keep a contextual Request work flow and a manager approval queue. Do not quietly replace approval with unrestricted task creation.
- If AI is necessary, make it a session utility with human-readable before/after changes instead of JSON. Preserve explicit approval, evidence, ambiguity/duplicate warnings, and stale-version protection.

**Files:** `Session.tsx`, `Standups.tsx`, optionally `Intake.tsx` / `AIReview.tsx`; summary service and tests where semantics change.

**Exit criterion:** core work is faster without increasing missed commitments, incorrect owners, or lost blockers.

### Phase 4 — Remove proven dead weight

Only after the pilot:

- Delete unused legacy board, standalone launch, and dashboard code rather than maintaining two permanent products.
- Remove intake/AI modules and their deployment dependencies only if their retirement is approved and downstream callers/data-retention needs are checked.
- Preserve old requests, transcripts, proposals, flags, and audit records through an appropriate read-only/history path or agreed export/retention process.
- Do not automatically convert historical participant flags into fresh action items; managers should explicitly triage unresolved ones.
- Keep existing database statuses initially. A vocabulary cleanup is not sufficient justification for a risky data migration.
- Update `README.md`, `docs/decisions.md` (especially ADR-001), API/operations documentation, and screenshots.

**Exit criterion:** the smaller product also has less maintained code and operational surface, not just fewer menu links.

## 6. What must survive simplification

- Current project/task permissions and employee self-scope. Hiding controls is not authorization.
- Required project context and safe defaults; no accidental permission widening through a universal default project.
- Ownership, due dates where relevant, and explicit blocker/follow-up resolution.
- Open items carrying forward across sessions without duplicate copies.
- Immutable historical updates and append-only audit records.
- Optimistic concurrency and understandable conflict recovery; use expected versions for new quick-edit paths.
- Attribution to the correct employee/task/session, especially when capture context changes.
- Human approval and conflict safeguards for any retained AI workflow.
- Visibility of taskless/team-wide blockers and follow-ups.
- Discoverable access to all work/history even when daily previews are intentionally short.

Avoid a backend rewrite, new microservices, configurable dashboards, user-built layouts, a new notification system, or AI auto-classification as part of this effort. Each would expand scope rather than distill it.

## 7. Validate with outcomes, not screen neatness

Record a baseline before changing behavior. Suggested pilot targets below are acceptance goals, not measured current performance:

| Test | Target |
|---|---|
| Employee identifies what needs attention | Within 5 seconds, without guidance |
| Employee posts a normal short update | Within 30 seconds, one text field, no duplicate report |
| Manager begins/resumes today's meeting | One action from Today |
| Facilitator records an owned follow-up | Within 15 seconds, without losing participant context |
| User updates status or completes a follow-up | In place, without visiting the board/history |
| User finds a past decision | Within 30 seconds from Today |
| Default primary navigation | Two destinations |
| Live workspace layout | One main content area and contextual capture, not three permanent panels |
| Critical data integrity | No lost blockers, duplicate commitments, or incorrect attribution in regression scenarios |

Test both roles at normal laptop and narrow/mobile widths, including keyboard-only use. Include no-session, late-update, no-change, empty-work, long-list, taskless-blocker, skipped-person, and stale-edit scenarios.

Use aggregate interaction timings/counts where available; do not collect note or transcript contents for this experiment. Supplement small-sample metrics with observation: where do people pause, hunt, or re-enter information?

## 8. Decisions to confirm before destructive removal

1. Is a separate intake approval process actually required, and who uses it?
2. Does anyone rely on Kanban to plan work outside standups, or is it simply available?
3. Does transcript reconciliation save more time than its review costs?
4. Must general employee updates be possible before the manager opens a session? Recommended: yes, without starting the meeting.
5. What typical team size must the participant selector support?

These questions should not block removing obvious duplication. They should block deleting business capabilities and historical data.

## Bottom line

The best first release is not a reskin of all seven sections. It is **Today + Work**, a focused standup mode, and concise outcomes. Preserve the intelligence in the data model while requiring far fewer choices from the person using it.
