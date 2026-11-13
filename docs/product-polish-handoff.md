# Product polish and intuitiveness — implementation handoff

## Instructions for the implementation agent

Implement this document against the **current simplified app**. Do not repeat the earlier redesign or produce another plan instead of changes.

Keep **Today + Work + focused standup + outcomes**. This pass is about making that smaller product feel complete, predictable, and easy to use—not adding features.

Read `docs/simplification-plan.md` for product constraints and `docs/pilot-checklist.md` for existing scenarios. Inspect the working tree and preserve unrelated changes. Implement in the delivery order below, with automated regression tests and browser verification. Do not delete historical data or legacy capabilities merely to clean up navigation.

### Review basis

Reviewed at commit `c37124e`, including the current React source, relevant API/service contracts, and the checked-in screenshots of Today, Work, live meeting, and outcomes. No fresh interactive browser test was performed for this handoff. Findings described as current behavior are grounded in source; reproduce the interaction failures before fixing them.

### The desired feeling

> I know what matters, I know what clicking will do, and I trust that my work has been saved to the right place.

The current structure is much better. Remaining rough edges are mostly:

- Controls that do not lead to the action users actually need.
- Hidden or unavailable paths for legitimate workflows.
- Inconsistent editing, saving, context, and recovery behavior.
- A clean layout that still exposes prototype language, tiny controls, and administrative forms.

**Priority definitions:** P0 = trust/completeness defects to fix first. P1 = required product-polish work. P2 = optional refinements only after P0/P1 pass. A cosmetic pass alone does not complete this handoff.

---

## 1. P0 — Never show or save work under the wrong person

**Evidence:** `useAsync` retains previous data when dependencies change. `Workspace.tsx` changes the selected participant immediately but renders old workspace data while the next request loads (`workspace.loading && !workspace.data`). Capture context can therefore combine the new person with the previous person's tasks. Background refreshes in `TaskDialog.tsx` also repopulate the entire edit form.

### Implement

- Distinguish **same-record background refresh** from **switching to another record/person**.
- On participant changes, render a short loading placeholder for that person's work and disable capture until the matching response arrives. Never leave old tasks actionable beneath the new name.
- Key workspace data and draft context by session and participant. Ignore stale responses and validate task/person context at save time.
- Do not overwrite dirty task fields when a blocker is resolved or an action is completed in the same dialog. Refresh related sections without resetting unrelated edits.
- Protect drafts on Close, Cancel, Escape, backdrop click, participant change, route navigation, and meeting exit. Use one consistent in-app discard confirmation; a pristine form closes immediately.
- Dirty detection must include owner, due date, status, task selection, and other edited fields—not only text.
- While a save is pending, prevent duplicate submission and prevent closing from silently abandoning an indeterminate operation. Provide a recoverable error state.

**Acceptance:** under a deliberately slow network, switching from Dana to Priya never shows Dana's actionable tasks under Priya. Editing a title and then resolving a blocker does not reset the title. All dismissal paths either preserve the draft or explicitly confirm its loss.

**Touchpoints:** `lib/hooks.ts`, `Workspace.tsx`, `CaptureDrawer.tsx`, `TaskDialog.tsx`, shared overlay primitives.

## 2. P0 — Give saved updates correct identity and edit semantics

**Evidence:** `Today.tsx` stores receipts as a string. Task updates can become the general-update receipt. Its Edit action restores that string but not the task association; the next save can create/overwrite a general daily update instead. Editing an existing daily update does not restore its saved next steps. Task selection is limited to the six-task preview.

### Implement

- Model saved feedback with its record kind, ID, task context, text, next steps, and saved timestamp—not a presentation string.
- Keep **general daily updates** separate from **task progress updates** in both state and UI.
- General update Edit loads all its existing fields and updates that same daily record.
- Task progress history is append-only: offer **View update** / **Add correction**, not an Edit action that implies historical replacement. A correction remains linked to the original task and preserves the original record.
- A task update must never populate or overwrite the general-update editor.
- Use the persisted server result to confirm the save. Reloading should show a consistent saved state.
- If task linking remains in the general composer, provide the full authorized task set through a searchable/paginated picker, not only the preview. A selected task must remain identifiable after filtering or pagination.
- Explain post-meeting updates accurately. Do not imply an update made after the standup was reviewed during that meeting or added to a historical snapshot.

**Acceptance:** save a task update, open its receipt, add a correction, and reload: both remain on that task and the daily update is unchanged. Editing a daily update preserves its next steps unless deliberately changed.

**Touchpoints:** `Today.tsx`, `TodayActions.tsx`, daily-update/task-update APIs and types as needed.

## 3. P0 — Make saves reliable, recoverable, and understandable

**Evidence:** `UpdateDialog` and `CaptureDrawer` submit progress and status as separate requests. If progress succeeds but status fails, the form reports failure even though part of the action was saved; retrying can duplicate progress. Meeting status changes do not send an expected version. Conflict recovery is usually only a transient error toast.

### Implement

- Prefer a small atomic backend operation for “save progress with optional status change,” retaining authorization, expected-version checks, and audit events in the same transaction.
- Make retried logical submissions safe against duplicate records, including response-loss retries. Reuse an operation identifier for a retry; use a new one for a genuinely new submission.
- If retaining separate operations temporarily, track partial success explicitly and retry only the failed operation. Do not resubmit already-persisted progress.
- On a conflict, preserve the user's text and offer **Load latest** plus an explicit way to reapply their change after review. Do not silently overwrite or blindly retry with a newer version.
- Show field validation beside the relevant field. Show operation/network errors inside the active form with a retry action.
- Do not expose a Start standup action while session state is still unknown or has failed to load. Handle concurrent session creation by recovering the existing session where appropriate.

**Acceptance:** inject a status conflict after entering an update; the user sees exactly what was saved and recovery cannot create duplicate progress. Rapid double-clicking does not create duplicate tasks, blockers, or follow-ups.

**Touchpoints:** `TodayActions.tsx`, `CaptureDrawer.tsx`, task/standup services and schemas, `lib/api.ts`, shared action handling.

## 4. P0 — Finish the missing paths and list contracts

These are completion defects, not requests for new product areas.

| Current gap | Required change | Acceptance |
|---|---|---|
| Today has no independent way to open a taskless help request; existing calls originate from task rows | Add a visible, secondary **Ask for help** action near the employee update area, available with zero tasks | Employee with no tasks can create a durable request and see confirmation |
| Live capture is opened only from task rows | Add a person-level **Add follow-up** action and a compact secondary menu for general help, decisions, and notes | Facilitator can record a commitment for a person with no tasks |
| `loadMoreAttention` treats `/today` as `Page<AttentionItem>`, but the API returns an envelope containing `attention` | Consume the actual envelope; deduplicate by stable entity identity and handle changing totals | More than 25 items load without crashing, repeating, or silently skipping items in normal paging |
| `TaskDialog` renders Owner as disabled even for managers | Provide authorized reassignment and project context editing; employee views remain appropriately constrained | Manager can reassign work without opening the legacy board |
| Project “View tasks” links use `/board?project=…`; the redirect loses context and Work does not read query state | Link directly to filtered Work and preserve supported query parameters on legacy redirects | Project link opens only that project's work |
| Capture owner options include only participants and facilitator | Offer eligible users outside the meeting too; default context is visible and changeable | Manager can assign a follow-up/help request to a nonparticipant |
| General notes are saved to `captures.notes` but Session renders only `session.notes` | Display captured notes in the collapsed meeting-details section with attribution and time | A saved general note is readable after finishing |
| Session participant reporting relies on legacy pre-meeting fields | Display current daily-update reporting accurately, with explicit historical semantics | A submitted daily update does not appear missing in the outcome view |

Also check authorization affordances across Today, task details, and outcomes. For example, backend blocker resolution allows owner, reporter, or manager; Today currently checks only owner/manager, while TaskDialog shows Resolve more broadly. Use consistent capability logic, ideally returned by the server, while preserving backend enforcement.

**Acceptance:** users are not offered actions that predictably return Forbidden, and permitted actions are not arbitrarily hidden in one view.

---

## 5. P1 — Make attention rows explain the problem and offer its solution

**Evidence:** blocked task rows currently offer Update / Needs help / Open. This emphasizes creating another blocker instead of handling the existing one. “+2 more” is noninteractive. A person's name may mean task owner, help owner, or follow-up owner without saying which.

### Implement

Use a common row pattern across Today and the live meeting:

```text
Attribution model v2                         [Review help] [More]
Needs warehouse access to continue.
Help owner: Jordan Lee · Due in 4 days · 2 other issues
```

- The task title opens details. Remove the redundant Open action beside the same clickable title.
- For blocked work, lead with **Review help**; expose Resolve directly when there is one clear blocker and the user can resolve it.
- For overdue or at-risk work, lead with **Update** or a clearly scoped review action. For an actionable follow-up, show **Mark done**.
- Keep **Report another issue** secondary when a help request already exists. Show existing requests before creating another; do not silently merge distinct blockers.
- Make “2 other issues” a button that reveals the actual reasons and associated records. Do not use a tooltip-only disclosure.
- Label ownership explicitly when it could be confused: “Task owner,” “Help owner,” or “Assigned to.” Keep the default row to one relevant owner line; expand for more.
- Use **Unassigned — needs an owner** where there is genuinely no responsible person. Never claim an optional-owner help request is already owned.
- Preserve overdue/urgent information even when a different leading reason is selected.
- Show aggregate counts honestly: “5 items need attention,” not “5 open” when those rows summarize multiple blockers/actions.

**Acceptance:** a user can answer “What is wrong, who handles it, and what can I do?” without opening an editor. One task's three issues remain individually reachable without three duplicate task rows.

## 6. P1 — Make Today a calm, complete daily starting point

Keep its current sections, but remove ambiguity and duplicated navigation.

### Employee Today

- Needs attention → My current work → optional update. Do not bury the optional update behind an unbounded first-screen list: show a sensible preview plus a clear total and **View all attention items** path.
- Put **Ask for help** beside the optional update heading or composer. This is always available, even on an otherwise empty day.
- Show a small **Saved at 9:42 AM** receipt for the general daily update, with its correct edit action. Avoid a permanent large green success panel for an ordinary saved record.
- Keep task updates available directly from task details as well as Today; no need to return home to report progress.
- Fix the current “Showing 3 of 5” messaging where two tasks are already above in attention. Either show the true remaining total or say “2 other tasks are shown above.” Do not imply missing work.
- Choose one View all work link per relevant context; remove the redundant header button if Work navigation and the section link already do the job.

### Manager Today

- One prominent Start / Resume / View outcomes action, determined only after session state loads.
- Rename “Team attention” to **Needs your attention** or **Team needs attention** consistently; include brief role context only if useful.
- Keep Past standups a recognizable secondary text link, not embedded indistinguishably in date metadata.
- No dashboard metrics or manager-personal-work panel added back.

**Acceptance:** both roles can identify their next action within five seconds. A quiet day looks complete, not like missing data. Error/loading states never say “Nothing needs attention.”

## 7. P1 — Make Work filters visible, persistent, and unsurprising

**Evidence:** Work defaults to To do/In progress without showing that scope, only a filter count is visible, empty search results lead with New task, and search/filter/task-selection state is not represented in the URL.

### Implement

- Above the list, make the default scope explicit: **Active work**. Offer a compact **Active / Completed / All** view selector; retain Backlog/Canceled in advanced filtering. Do not add another navigation destination.
- Keep search and Filters adjacent. Use a filter icon rather than another search icon.
- Show active nondefault filters as removable, readable chips, not only a numeric badge.
- Store search, filter, pagination, and selected-task context in URL state. Browser Back and reload should restore the user's place. A task link should open the same shared detail surface.
- Default employee scope should be explicitly personal if labeled “My work”; do not label all accessible tasks as personally assigned. Provide accessible additional scope only where the existing permissions allow it.
- After a status change causes a task to leave the filter, confirm **Marked done** without replacing the whole list. Offer a short-lived Undo only if it can safely use the existing mutation model/version check.
- Clamp/reset pagination after the last row disappears. Hide Previous/Next when there is only one page.
- Differentiate empty states:
  - No work yet → create a task if authorized, or explain how work gets assigned.
  - No search matches → clear search.
  - No filter matches → reset filters.
  - No active work → reassuring completion message and View completed.
- Do not infer “no projects/users exist” from a failed or still-loading options request.

**Acceptance:** a user can explain why these tasks are showing, remove a filter in one action, and return from details without losing their query or scroll position.

## 8. P1 — Make task details useful before they become a form

**Evidence:** opening a task immediately presents a large edit form; the shared dialog lacks an Add update entry point and mixes resolved blockers/completed actions into current concerns. New task exposes seven fields, including advanced metadata, from the start.

### Task detail

- Open with the task title, clear status/owner/due date, latest update, and outstanding help/follow-ups.
- Offer **Add update** and context-appropriate actions at the point of reading.
- Use one explicit **Edit details** mode for metadata instead of making every task visit an editing session. Avoid nested dialogs; switch the existing surface to the requested subview where practical.
- Move priority/risk settings into secondary details unless they explain a current exception.
- Show open blockers/actions first. Put resolved/completed items in history; don't give a resolved blocker a red treatment or describe it as “days open” now.
- Save is enabled only for valid changes. Use **Save changes**, and show exactly which fields need attention.
- Make the task's full title available on small screens; don't rely exclusively on truncation or hover.

### New task

- Initial visible fields: title, project when not unambiguously selected, and owner.
- Default status to To do. Put description, due date, priority, and nondefault status behind **Add details**.
- For an employee, use an explicit self-assignment default only where permitted. Managers choose an owner or deliberately leave it unassigned.
- If project creation is necessary, provide an authorized **Create project** action that preserves the draft. Do not tell users to escape through Work → Filters → Manage projects.
- If the user cannot create projects, explain the dependency without offering a forbidden action.

**Acceptance:** ordinary task creation is a short form; opening a task answers “what is happening?” before asking the user to edit it. Reassignment remains possible for managers in the new UI.

## 9. P1 — Make the live meeting feel like a guided conversation

Keep the focused, one-person-at-a-time layout. Refine the sequence rather than adding panels.

### Implement

- Rename the main progression action **Review & next** or **Mark reviewed & next**. Viewing/skipping someone never marks them reviewed.
- Keep Finish secondary while people remain; after the final review, show a calm completion state with **Finish standup** as the primary action.
- For a reviewed participant, distinguish “Reviewed” from the action **Next unreviewed**; do not leave a Next button that merely produces a toast when no one remains.
- Let a facilitator explicitly undo an accidental review through the roster, subject to existing backend rules. Do not conflate review reversal with changes to captured records.
- Display the actual latest update time and whether it is a daily note or task update. “No daily update” must not suggest there are no task updates.
- Keep task context preselected in capture, presented as readable context with **Change**. Don't force a dropdown inspection for every entry.
- Make follow-up ownership prominent and require a deliberate choice if leaving it unassigned. Do not infer the responsible person from the prose with AI.
- Put optional rationale/next steps behind disclosure rather than permanent fields.
- Use **Save update**, **Create follow-up**, **Record decision**, etc., rather than a generic Save for all record types.
- Use one success confirmation per capture, not both a toast and a top banner. Include a short **View entry** link so the facilitator can verify what was saved.
- Exit should read **Back to Today** and leave the meeting resumable; it must not look like finishing or canceling the meeting.
- Refresh reviewed state and newly submitted updates on safe triggers such as window focus and modest polling during the live meeting. Never overwrite an active draft or silently switch people. No WebSocket infrastructure required.

**Acceptance:** a facilitator handles a no-task participant, an outside owner, a late employee update, an accidental review, and final completion without a second notes tool or uncertainty about meeting state.

## 10. P1 — Unify the visual language and remove prototype signals

This is a consistency pass, not a new visual theme. Keep the restrained emerald accent, neutral surfaces, and generous whitespace.

### Shell and layout

- Replace the mostly empty 208px desktop sidebar with a compact app header: brand, **Today**, **Work**, and account control. On mobile keep both destinations directly reachable; two items do not need a hidden navigation drawer.
- Align each page heading, content, and actions to the same grid. Today/outcomes currently nest a narrower body beneath a wider header; eliminate the visibly different left edges.
- Use an approximately 800px reading width for Today/outcomes and up to approximately 1040px for Work/meeting. These are maximums, not fixed widths.
- Keep focused meeting mode without global navigation; retain its clear exit.
- Hide Pilot tools, Legacy board, and development identity controls from normal production presentation. Actual pilot access must be explicitly configured, not just inside a collapsed section. Preserve needed pilot URLs/data and gate every related entry point consistently.
- Keep project settings discoverable for authorized project owners/managers outside a filter modal, for example in Work's project context menu.
- If transcript import is enabled, open it from the session's secondary actions with the session preselected. Do not promote it in every summary header.

### Shared design rules

- Page title: approximately 24px; section title: 16–18px; body: 14–16px; secondary metadata: 12–13px. No essential 9–11px instructions.
- Sentence-case form labels; remove pervasive tiny uppercase labels.
- Consistent 8px spacing rhythm, 12–16px row padding, restrained borders, and one radius scale. Reserve pronounced shadow for overlays, not every content region.
- Primary controls approximately 40px high; touch targets at least 44px where touch is expected. Compact row controls must still have sufficient spacing and usable hit areas.
- One dominant filled action per workflow step. Row actions stay secondary.
- Color indicates state but never replaces a text label. Do not paint routine metadata like a warning.
- No decorative charts, gradients, confetti, new card grids, custom dashboard builders, or decorative empty-state illustrations.

### Copy replacements

| Current pattern | Preferred treatment |
|---|---|
| “Tasks you can act on, without a planning suite.” | “Active work” or omit the subtitle |
| “Durable help request,” “structured record,” “carry forward” | “This stays open until it is resolved.” |
| “Needs help” used as both status and creation button | Status: “Needs help”; action: “Ask for help” / “Report issue” |
| “Yesterday” as the entire overdue indicator | “1 day overdue” |
| “in 4d” | “Due in 4 days” |
| “+2 more” | “2 other issues” as an actual disclosure button |
| “Save” | Name the operation: “Save update,” “Save changes,” etc. |
| “Owned help request” when no owner was selected | “Help request saved. No owner assigned yet.” |

**Acceptance:** screenshots of Today, Work, task detail, meeting, and outcomes look like one coherent application; normal users see no pilot/development terminology.

## 11. P1 — Establish one standard for feedback, overlays, and accessibility

**Evidence:** shared Modal/Drawer declare modal semantics but lack focus trapping, background inertness, scroll locking, and focus restoration; Modal is not associated with its heading. Toasts disappear after 3.2 seconds without a dismissal control/live-region semantics. Ordinary refreshes replace entire lists with a loading screen.

### Implement

- Use one proven accessible dialog/drawer behavior: heading association, initial focus, trapped focus, inert background, body scroll lock, topmost-only Escape, and trigger focus restoration.
- Route all dismissals through the dirty-state guard. Confirmation dialogs must not cause two underlying Escape handlers to fire.
- On mobile, use a full-width/full-height detail surface with scrollable content and reachable action footer. Account for safe areas and the virtual keyboard.
- For menus/disclosures, support keyboard activation, Escape/outside dismissal where appropriate, correct expanded state, and focus return. Never place essential actions behind hover alone.
- Initial load: lightweight, layout-matching skeletons. Same-record refresh: retain content and scroll, with a subtle busy indicator. Different-record load: do not retain actionable old context (see section 1).
- Prefer inline saved state for ordinary edits; use one toast for cross-context events. Add dismiss controls and appropriate polite announcements. Errors stay visible near the failed action until resolved/dismissed rather than vanishing before they can be read.
- Announce status changes without moving focus. Add global visible focus styles for links, selects, summary controls, and custom buttons—not only `.btn`.
- Respect reduced motion. Use only short, purposeful transitions, roughly 120–180ms; no animated page reshuffling.
- Unknown routes should provide an understandable not-found state; missing/inaccessible tasks should offer Back to Work rather than silently redirecting to Today.

**Acceptance:** complete the core flow with keyboard only and a screen reader smoke test. No focus escapes an open modal, no background page scrolls under it, and failed saves remain recoverable without retyping.

## 12. P1 — Make history and time semantics trustworthy

### Outcomes and history

- Title summaries **Standup outcomes · Nov 13**, with the year when needed to disambiguate. Explain “Completed with 3 people not reviewed” rather than silently placing “1 of 4 reviewed” beside Completed.
- Keep Next actions, Help still needed, and Decisions as the primary sections.
- Make taskless blockers resolvable from outcomes when permitted, not only task-linked blockers through Open task.
- Provide task links for actions/decisions where present. Group repeated task context without merging distinct records.
- Put captured notes, participant updates, resolved items, and audit details behind a single clear **Meeting details** region with internal sections. Avoid four equally prominent empty accordions.
- Load detail/audit data on demand where practical. A failed request must not render a zero count or empty history as if nothing happened.
- Preserve the distinction between **recorded during the meeting**, **submitted later**, and **still open now**. Do not rewrite meeting history when today's daily update changes.
- Past standups currently requests only 60 sessions. Add real pagination/load more and a modest date filter; show years for older entries. Do not add a global search product.

### Dates

- Centralize date-only, timestamp, due-date, and age formatting. A historical completed task must not read “overdue” just because its old due date is in the past.
- Define one documented team/day-boundary policy and use it for Today, daily updates, standup dates, and overdue calculations. Browser-local dates and backend `date.today()` can otherwise disagree around midnight.
- Use server-provided business-date context if needed; this does not require a user-configurable timezone settings screen.
- Use complete labels such as “Due tomorrow,” “2 days overdue,” and “Opened 3 days ago.” Expose exact dates accessibly.

**Acceptance:** reopening an older standup does not imply later edits were known during that meeting. Dates are consistent across Today, Work, task details, and summaries, including midnight/timezone boundary tests.

---

## Optional P2 refinements

Only after the above works:

- Discoverable Cmd/Ctrl+Enter to submit a valid update; do not intercept ordinary multiline Enter or IME composition.
- A small in-app Undo for safe reversible actions, backed by current permissions and version checks. No fabricated Undo for append-only history.
- Remember the user's Work view in URL state first; add preferences only if observed use justifies them.

Do not add notifications, AI auto-capture, a command palette, onboarding tours, gamification, new dashboard sections, or another settings product in this pass.

## Delivery order

### Increment A — Trust and completeness

Implement sections 1–4, plus the shared overlay accessibility foundation in section 11. Add targeted regression coverage before styling around the defects. Keep changes small enough to inspect and revert.

### Increment B — Intuitive daily flows

Implement sections 5–9. Reuse the same task-detail, row-action, capability, draft, and save semantics across views. Avoid three subtly different implementations of the same task operation.

### Increment C — Cohesive finish

Implement sections 10–12. Apply visual tokens consistently, finish mobile/keyboard behavior, verify copy and date semantics, and update screenshots/documentation.

### Increment D — Verification and handoff

Run the repository's existing backend tests/lint and frontend typecheck/build. Add frontend interaction/browser regression coverage: the current `frontend/package.json` has no frontend test script. Prefer a small test setup focused on the critical journeys, not a testing-platform rewrite.

Report commands and results, screenshots by role/viewport, unresolved limitations, and any deferred P2 items. Do not claim user testing or a completed pilot unless it actually happened.

## Required verification matrix

| Scenario | Pass condition |
|---|---|
| Slow participant switch; stale response arrives late | Only the selected person's matching workspace is actionable |
| Close/Escape/backdrop/Back/exit with unsaved edits | Consistent draft preservation or explicit discard confirmation |
| Task edit plus blocker resolution | Unsaved task fields survive the related mutation |
| Task update receipt and correction | Task association retained; daily update untouched |
| Daily-update edit with next steps | Existing fields restored; no accidental field erasure |
| Progress + status conflict / response loss / double submit | No silent partial success or duplicate records; recoverable draft |
| More than 25 attention items / more than 60 standups | All authorized items reachable through correct pagination |
| Employee with no tasks asks for help | Durable request visible to the right users |
| Participant with no tasks; owner outside the meeting | General capture works and assignment is correct |
| Unauthorized and authorized resolve/reassign actions | UI matches backend capabilities; backend still enforces them |
| Search/filter/detail/back/reload | Query, selected task, and position remain understandable |
| Complete last item on last results page | No stranded empty page or impossible count |
| Zero projects / options still loading / options fetch fails | Distinct, truthful states and permitted recovery paths |
| Saved general note, daily note, and decision after finish | Each is findable with correct attribution and time context |
| Post-meeting update / historical session / midnight boundary | No misleading review claim, rewritten history, or date disagreement |
| Network failure / expired identity / 403 / 404 / 409 | Clear, actionable state; no unexplained redirect or lost draft |
| Keyboard-only and screen-reader smoke test | Named dialogs, correct focus, labeled controls, announced feedback |
| 375px mobile, 768px tablet, 1280px and 1440px desktop; 200% zoom | No horizontal page overflow, inaccessible footer, clipped action, or hover-only dependency |
| Production-like configuration | No dev identity switch or ungated pilot/legacy navigation |

### Final definition of done

- Both roles can identify the next action in approximately five seconds.
- A normal update takes one short input and one save, with unambiguous confirmation.
- A manager can create an owned follow-up without leaving the conversation context.
- No normal operation requires visiting the legacy board.
- Common actions use consistent labels, permissions, and save/recovery behavior everywhere.
- Essential state remains visible without reintroducing the old clutter.
- The app feels finished because it behaves reliably—not because it has more animation or more screens.
