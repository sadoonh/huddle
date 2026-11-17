# Elevated components + polished Kanban — implementation handoff

## 1. Direction and scope

**Build a restrained, tactile work application inspired by Forever's Atelier components. Make Work a polished Kanban board.**

This is an implementation brief, not a request for another plan. The product is already simpler and more usable; now its components should feel intentionally designed rather than like a collection of default forms and bordered lists.

### This document supersedes earlier guidance

The user explicitly wants **Kanban as the Work experience**, similar in function to the legacy board but substantially more polished. This overrides the list-first / remove-Kanban recommendations in `docs/simplification-plan.md` and `docs/product-polish-handoff.md`.

Keep:

- Two primary destinations: **Today** and **Work**.
- Today as an actionable daily overview, not another board.
- Focused standups and outcome summaries.
- Recent improvements to draft protection, authorization, atomic saves, conflict handling, URL state, date semantics, and accessible overlays.

Do not reintroduce the old dashboard, seven-way navigation, duplicated editors, or permanent meeting side panels.

### Implementation baseline

Reviewed current source at commit `d65dabc`:

- `Work.tsx` is a filtered, paginated list with URL-backed context.
- `Board.tsx` is the legacy five-column board, with native HTML dragging, a 200-task fetch, and its own older editor/create flow.
- Shared task detail/create components, confirmation handling, and an accessible overlay foundation now exist.
- The app uses React 18, Tailwind, and React Router. Playwright smoke coverage exists in `frontend/e2e/polish-smoke.mjs`.

**Evolve the current Work page and shared components. Use the legacy board as a functional reference, not as code to restore wholesale.** Inspect the working tree before editing and preserve unrelated work.

## 2. Design references and usage boundaries

The following public component pages and their implementation notes were studied. These are behavior/design references, not a claim that their animations were interactively verified in this review.

| Reference | Apply to this app | Borrow | Do not import unchanged |
|---|---|---|---|
| [Kanban Move](https://forevercomponents.com/components/drag-reorder/kanban-move/) | Cross-column task moves | Lift, spatial continuity, restrained settling | Auto-moving demo, fixed fake cards, decorative pseudo-element content |
| [Magnetic Kanban Swimlanes](https://forevercomponents.com/components/drag-reorder/magnetic-kanban-swimlanes/) | Drop targets | Obvious destination highlight and preview | Pointer-only movement; the page documents missing keyboard reorder |
| [Atelier Morph Select](https://forevercomponents.com/components/inputs-switches/atelier-morph-select/) | Status, owner, project controls | Compact trigger, connected option tray, refined transition | Demo lifecycle, hardware/sample-rate vocabulary |
| [Segmented Control](https://forevercomponents.com/components/inputs-switches/segmented-pill/) | Team / My work scope and narrow-screen column selection | Sliding selected surface and clear state | Auto-cycling, excessive spring stretch, incomplete selection semantics |
| [Crate Toggle Group](https://forevercomponents.com/components/buttons/crate-toggle-group/) | Same segmented-control family | Roving keyboard navigation, restrained thumb movement | Audio-specific content or a second competing visual style |
| [Atelier Draw Checkbox](https://forevercomponents.com/components/inputs-switches/atelier-draw-checkbox/) | Follow-up completion | Stroke-drawn checkmark and subtle text transition | Demo counters, animation-driven completion, tiny targets |
| [Async Action Button](https://forevercomponents.com/components/buttons/async-action-button/) | Save update, create task, finish meeting | Stable-width idle → working → saved feedback | Timer-based fake success; the reference has no error state |
| [Atelier Morph Dialog](https://forevercomponents.com/components/feedback-states/atelier-morph-dialog/) | Small confirmations | Visual connection between trigger and confirmation | Replacing accessible focus/draft handling with a visual-only widget |
| [Undo Snackbar](https://forevercomponents.com/components/feedback-states/undo-snackbar/) | Successful reversible status changes | One compact notification with an action | Automatic demo cycles, simulated rollback, a mandatory tiny undo window |

### Source and licensing

- Treat these as inspiration unless authorized component source is supplied or obtained through the site's permitted account/copy flow. Respect its license and access terms; do not bypass copying restrictions or scrape gated source.
- Do not block implementation on account access: original React implementations of the described interaction patterns are acceptable.
- No embedded demo iframes in the app. No remote Forever runtime dependency.
- Remove all autonomous demo behavior. Never animate real task state as a demonstration.
- References are not certification of accessibility. Verify the production components independently.

## 3. The visual system: quiet, tactile, precise

The app should be recognizably more refined **even in a still screenshot**. Motion supports this design; it must not be the only improvement.

### Starting tokens

Define semantic tokens once; adjust after checking real screenshots and contrast rather than scattering arbitrary colors through components.

| Token | Starting direction |
|---|---|
| App canvas | Warm near-white `#F6F5F2` |
| Recessed lane / control track | Soft stone `#EEEDE8` |
| Raised card / overlay | White `#FFFFFF` |
| Primary text | Deep charcoal `#202824` |
| Secondary text | Muted charcoal `#626B64` |
| Hairline border | Soft neutral `#DDDFD8` |
| Primary accent | Deep emerald `#176B50` |
| Selected tint | Pale sage `#E7F0EA` |
| Warning / overdue | Accessible amber / brick, paired with text and icon |
| Control radius | 9–10px |
| Task-card radius | 12px |
| Sheet/dialog radius | 16px on desktop; appropriate full-screen treatment on mobile |

Use separate semantic warning/error/success tokens and check actual foreground/background pairs for contrast. Do not use low-contrast color merely because it looks subtle.

### Surface hierarchy

1. **Recessed:** quiet lane backgrounds and segmented-control tracks; no prominent outer shadow.
2. **Raised:** white task cards with a fine border and a restrained contact shadow.
3. **Floating:** menus, dragged cards, and detail sheets with stronger but soft shadow.

Suggested card resting shadow: `0 1px 2px rgba(25,35,28,.05), 0 4px 10px rgba(25,35,28,.025)`. Hover increases depth slightly; dragging uses a separate elevation token. No heavy dark outlines, permanent glows, or colored priority stripes on every card.

### Typography and spacing

- Use one clean sans-serif stack. Geist is a suitable option if loaded responsibly with permitted font assets and a system fallback; do not add multiple display fonts.
- Page headings 24–28px; lane/section headings 14–16px; card titles 14–15px medium/semibold; body 14px; metadata 12–13px.
- Normal readable line heights; no tiny uppercase field labels.
- Use a consistent 4/8px spacing scale, 14–16px card padding, 12px gaps between cards, and 16–20px between lanes.
- Primary controls approximately 40px high; touch hit areas at least 44px where needed.
- Icons from one family, consistent size/stroke. Counters use tabular numerals.

### Motion vocabulary

- Hover/press: 100–140ms; selected indicator/popover: 160–220ms; sheet and card placement: 180–260ms.
- Maximum normal card hover lift: about 1px. Drag lift can scale to about 1.015. Do not tilt dense task text.
- One restrained easing family; at most a small settling motion for drag placement. No prolonged bouncing.
- Reduced motion removes travel, spring, and stroke animation without removing state feedback.
- No idle loops, moving backgrounds, cursor attraction, confetti, glass over text, or animated status counts.

## 4. Work becomes the main Kanban board

### Layout

```text
Work                                         [Filters] [New task]
[Team | My work]   [Project: All projects v]   [Search work…]
[Owner: Priya ×] [Needs help ×]                       [Clear]

Backlog  8        To do  12         In progress  6       Done  24
[+ Add task]      [+ Add task]      [+ Add task]
┌────────────┐    ┌────────────┐    ┌────────────┐       ┌────────────┐
│ Task title │    │ Task title │    │ Task title │       │ Task title │
│ Project    │    │ Needs help │    │ Project    │       │ Project    │
│ Owner  Due │    │ Owner  Due │    │ Owner  Due │       │ Owner      │
└────────────┘    └────────────┘    └────────────┘       └────────────┘
```

- Default columns: **Backlog**, **To do**, **In progress**, **Done**.
- Preserve existing database status values. Blocked/at-risk are not columns: they remain independent task conditions.
- Canceled tasks remain reachable through **Show canceled** in board options, revealing a fifth column. Also offer Cancel task through appropriate task actions. Do not delete or silently remap canceled records.
- No mandatory Board/List switch or parallel redesigned list in this scope. Work is the board.
- Managers default to Team and can switch to My work. Employee default should match the scope the app actually queries; do not label all accessible work as personally assigned. Preserve existing authorized access paths.
- Replace the old Active / Completed / All control with board-appropriate scope. Default filtering must include all four displayed statuses; do not reuse the list's default `todo/in_progress` filter and render misleading empty lanes.
- Keep project selection and search easy to reach. Put less common owner/priority/exception filters in Filters, with removable chips when active.
- Preserve search, project, owner, relevant filters, selected task, and canceled-column preference in the URL. Normalize or map old `view`, `status`, and `page` query parameters deliberately; old bookmarked task/project links must still work.
- Status-filtered URLs should explicitly identify the filter and retain lane structure as drop targets where useful. Do not silently ignore a filter or make all destination lanes disappear.

### Board width and scrolling

- Give Work a route-specific wide layout, approximately `max-width: 1440px`, instead of inheriting the narrow reading width from `Layout.tsx` and `Work.tsx`.
- Keep Today/outcomes at their existing reading widths. Match the board page header to the board's left edge.
- Aim for 270–320px readable lanes; fit four across when space allows. Never shrink cards to fit all columns at the expense of readability.
- Use one page-level vertical scroll and an explicitly bounded board horizontal scroll region at intermediate widths. Avoid four independently scrolling columns in the first implementation.
- Lane headings stay visible during normal board scanning where practical; ensure sticky elements do not cover menus or conflict with the global header.
- No global pagination that changes every lane at once. Each lane loads more independently.

### Mobile and narrow layouts

- At small widths, show one full-width lane with a compact, keyboard-accessible column selector and counts above it. Preserve the selected lane in URL state.
- Do not force phone users to drag horizontally across a board to find Done. **Move to…** is the primary mobile status-change path.
- Use horizontal scrolling for the column selector if necessary, not clipped task controls or document-wide overflow.
- Tablet/desktop use the multi-column board as space allows. Choose the breakpoint based on usable lane width, not device names alone.

## 5. Component specifications

These are reusable component responsibilities, not a requirement to create a large component framework. Proposed names may change to fit the repository.

### C01 — `TaskCard`: the signature raised surface

**Replaces:** default Work rows and legacy priority-striped cards.

**At rest:**

- Two- or three-line task title, legible and prominent.
- Project context only when helpful; omit redundant project labels on a single-project board.
- One leading exception indicator, with a readable count/disclosure when additional issues exist.
- Owner avatar plus a name or accessible owner label, and meaningful due-date text.
- Persistent, low-emphasis More button. No full-width status select on every card: the column already communicates status.
- Do not display description paragraphs, routine priority badges, progress history, blocker lists, and multiple action buttons on every card.

**Interaction states:**

- Hover/focus: slight border/depth change; essential content and actions already exist without hover.
- Press: tactile surface compression, without shifting surrounding layout.
- Selected: fine emerald ring and consistent highlight while task details are open.
- Dragging: separate overlay elevated above lanes; source space remains understandable.
- Saving move: small pending treatment; no fake completion check.
- Failed move: restored authoritative position plus a recoverable explanation.
- Read-only: details remain accessible, movement actions reflect capabilities; do not imply drag is available.

**Actions:** title or noninteractive card area opens the shared detail sheet; More offers Move to…, Add update, and relevant secondary actions. Nested controls must not trigger card opening or drag. No entire-card button containing other buttons.

**Acceptance:** readable at 280px lane width; a blocked card does not become a wall of badges; keyboard users can open it and change status without dragging.

### C02 — `KanbanColumn`: a quiet lane, not a stack of panels

**Replaces:** legacy fixed 240px columns with repeated header bars.

- Soft recessed background, concise heading, subtle state dot, and accurate total count.
- Top-of-lane Add task for Backlog, To do, and In progress opens the shared create flow with that status preselected. Global New task defaults to To do.
- Do not encourage creating already-completed tasks from Done; use its empty state to explain how completed work arrives.
- Empty lane: short contextual message, not repeated “Drop tasks here” instructions everywhere. During a drag, reveal a clear drop region.
- Drop target: sage tint and border/placeholder visible without violent expansion of the lane.
- Loading, error, and load-more states are per lane. Failed data is not a zero count.
- Footer: **Show more — 20 of 84 loaded** when applicable. Total means the full filtered total, not the loaded slice.

### C03 — `MorphSelect` / searchable picker

**Reference:** Atelier Morph Select.

**Replaces:** status and owner selects in task details; project selection in Work; participant selection where the same pattern is appropriate.

- Trigger is a compact rounded control with a visible label/value, icon or avatar when useful, and chevron.
- Option tray grows/fades from the trigger with consistent corner radius and surface depth. Use a portal and collision handling so board overflow cannot clip it.
- Selected option has a checkmark, not just a tinted background.
- Use a small select/listbox for status; a searchable combobox for long user/project lists. Do not build a tiny unsearchable menu of 80 people.
- Arrow keys, Home/End as appropriate, typeahead/search, Enter, Escape, outside dismissal, and focus return must work.
- Stable trigger dimensions; error/help text never causes the whole toolbar to jump.
- Native date inputs can stay native; do not invent a calendar merely to make every field custom.

**State contract:** controlled value, options/loading/error/disabled, change callback, accessible label, and validation message. Visual transition does not own business state.

### C04 — `SegmentedControl`

**References:** Segmented Control and Crate Toggle Group.

**Applies to:** manager Team / My work and mobile lane selection. Do not add gratuitous segments to other screens.

- Recessed track with a raised selected pill, thin border, and short sliding transition.
- Active text has sufficient contrast; labels remain stationary as the indicator moves.
- Correct semantics for the usage: tabs when controlling panels, radio/group semantics for a choice. Do not use only colored buttons with unannounced selection.
- Keyboard navigation, no auto-cycling, reduced-motion fallback.
- Counts are text, not rolling odometer animations.

### C05 — `AsyncActionButton`

**Reference:** Async Action Button.

**Replaces:** disconnected spinner-plus-toast feedback for short create/save operations across the shared task/update flows.

- `idle`: descriptive verb such as Save update.
- `pending`: Working/Saving label and compact indicator in a reserved icon slot; stable width; repeat activation disabled.
- `success`: brief drawn check plus Saved, driven only by server-confirmed success. Return to idle or close the flow according to its existing behavior; never delay navigation just to finish an animation.
- `error`: text error adjacent to the control/form, retry available, draft retained. Do not animate a success before discovering failure.
- Expose busy state accessibly. Long operations get honest ongoing feedback rather than an artificial short success timer.
- Add a restrained top highlight/contact shadow and 1px press depression to primary buttons. No magnetic cursor movement or glossy gradient treatment.

### C06 — `CompletionControl`

**Reference:** Atelier Draw Checkbox.

**Applies to:** follow-up/action-item completion on Today, task details, and outcomes—not a replacement for the multi-state task workflow.

- Use a real checkbox or an appropriately labeled action button according to the actual reversible behavior supported.
- On confirmed completion, draw the check once and soften/strike the item text. Do not remove the row before the user can understand what happened.
- Restore the prior appearance on failure; keep an actionable error.
- If the item then leaves a filtered list, use a short exit transition and preserve focus on a logical nearby item/section.
- Preserve explicit labels for screen readers and usable touch targets.

### C07 — shared `TaskDetailSheet`

**Build on:** current `TaskDialog` behavior and overlay infrastructure.

- Desktop: right-side sheet with a softly elevated edge, clear task title/context, scrollable content, and actions that stay reachable.
- Mobile: full-screen detail surface with an explicit back/close control.
- Enter from the right with a restrained transition; maintain the task card's selected state behind it. Avoid elaborate card-to-fullscreen geometry morphs that break on scrolling, pagination, or reduced motion.
- Reuse the current overview/edit modes, capabilities, draft protection, update/correction flows, conflict recovery, and reassignment.
- Never revive the private legacy `TaskEditor` or add a second copy of the same task form.
- Close returns to the same board filters, scroll position, lane, and logical focus. Deep-linking directly to a task still works even if it isn't in the currently loaded cards.

### C08 — confirmation surface

**Reference:** Atelier Morph Dialog.

- Small confirmation dialogs can visually emerge near their trigger on desktop, but must use the existing accessible overlay and confirmation semantics.
- Use a short opacity/scale transition with a matching surface/radius; do not literally morph a button into a focus-trapping dialog if that complicates reliability.
- Preserve draft-discard guards and clear labels. Finish standup is still explicit; moving a task to Done never finishes a meeting.

### C09 — action snackbar

**Reference:** Undo Snackbar.

- One compact, elevated snackbar for a board move: **Moved to In progress** and, when safe, Undo.
- Extend the existing toast infrastructure rather than introducing a second competing stack.
- Undo performs a real authorized, version-checked reverse mutation; it does not merely move a card visually.
- If the task changed again, do not overwrite newer changes. Explain why Undo cannot proceed and load the current task.
- Give sufficient time to act, pause dismissal on hover/focus, include Dismiss, and respect reduced motion. No forced decorative countdown ring.
- A failed move must leave recoverable feedback beyond a quickly disappearing toast.

## 6. Drag-and-drop behavior and data integrity

### Movement is a status change, not a magic visual trick

- Use a maintained React-compatible drag-and-drop approach with pointer, keyboard, touch support, and a drag overlay. A small focused dependency is acceptable if justified; do not transplant the reference's decorative demo engine.
- Drag starts from a clear handle or a deliberate activation threshold. Clicking a title/menu should never start dragging.
- Desktop pointer movement: lift → target lane highlight → drop → pending move → server-confirmed settle.
- Keyboard: discoverable handle and instructions; lift/move/drop/cancel behavior; announce the card, destination, success/failure, and focus outcome.
- Always provide **Move to…** with the same authorized states. It is the primary alternative on touch devices and must not be hover-only.
- Escape or dropping outside a valid lane cancels without a mutation. Dropping into the existing status is a no-op.
- Temporarily prevent another mutation of the same card while its move is unresolved. Use per-card pending state, not a single global `moving` string that mishandles concurrent cards.
- Keep hover/drop feedback client-side; submit one mutation only on committed drop.

### Persist and recover correctly

- Send `expected_version` through the current task-status API. Preserve backend permission checks, version increment, and audit history.
- Optimistic movement is acceptable, with a clear pending state. On definite rejection, restore/reconcile the card and counts. On an ambiguous network timeout, fetch authoritative task state before assuming the mutation failed or blindly retrying.
- On `409`, load current server state and explain the conflict. Never force the stale move using a refreshed version without explicit user intent.
- Changing status must not close blockers, complete follow-ups, reassign the task, or change project membership as a side effect.
- A task can reach Done with open related issues under the existing domain rules. Preserve those records and show their warning; don't silently clear them to make the board tidy.
- If a move causes a card to leave the current filter, tell the user why and offer View task. Keep counts and cached lanes consistent.

### No pretend within-column ordering

The current task model/API does not expose persisted board rank. For this release:

- Drag across columns changes **status only**.
- Keep a deterministic server sort within each lane, with a unique tie-breaker. Prefer the current due-date-first approach, adding stable ID ordering as needed.
- Do not show positional insertion/reordering that resets on reload. Highlight the destination lane rather than pretending the exact hovered slot will persist.
- Show a quiet **Sorted by due date** explanation in board options.
- Same-lane drag does nothing. Persisted manual ordering is a separate future capability, not an implicit part of this styling pass.

## 7. Fetching, totals, filters, and creation

**Do not group the first 25 or 200 mixed-status tasks into columns and present that as the board.**

- Fetch each visible status independently using the existing `status`, filter, limit, and offset support, or add one narrowly scoped board query if that is demonstrably simpler.
- Initial page can be approximately 20 cards per lane. Fetch more independently; totals are full server-filtered totals for that lane.
- Every lane uses identical search/project/owner/exception filters and current-user authorization.
- Preserve existing content for same-query refreshes; never briefly display old-project cards as current when a filter/scope changes. Disable dragging stale query results during transitions.
- De-duplicate by task ID. After mutations, invalidate/reconcile affected lane pages and totals; take care that offset paging doesn't skip a task when earlier rows move out. Reload affected page ranges if necessary.
- A failure in one lane should not blank the entire board. Show Retry in that lane and avoid fabricated total zero.
- New task from a lane passes `defaultStatus` into the shared creation flow; ensure default/dirty-state tracking uses that same initial value. An employee self-assignment default remains permission-aware.
- Project/owner filter context may seed creation only where unambiguous and permitted. Never silently choose an unrelated first project.
- After creation, show the persisted card in the correct lane or provide a truthful **Created — outside current filters** confirmation with View task.
- Keep task/detail state in the URL independent of lane pagination. Closing a sheet must not wipe project/search state.

## 8. Apply the component family beyond Work

This is a cohesive app treatment, not a beautiful board attached to plain legacy forms.

- **Today:** retain concise attention/current-work rows; use the new status/owner pickers where appropriate, async save buttons, and follow-up completion control. Do not turn every row into a large Kanban card.
- **Live standup:** retain one main workspace; use the same participant picker, follow-up control, capture buttons, and confirmation surfaces. No board embedded inside the meeting.
- **Outcomes:** use the same completion/feedback treatment and shared task-detail sheet. Preserve historical/current-state distinctions.
- **Forms:** consistent field shells, focus states, option trays, error presentation, and buttons. Do not rebuild every input when a native input remains clearer.
- **Navigation:** retain the compact Today/Work header. A quiet selected-surface transition is enough; no animated dock or radial menu.

## 9. Implementation map and sequence

### Step A — Tokens and component primitives

- `frontend/src/index.css` and theme configuration: surface, typography, spacing, radius, shadow, and motion tokens.
- `components/ui.tsx` or small focused files: button states, picker/segment primitives, completion treatment, overlays.
- Preserve current accessibility infrastructure. Introduce only the dependencies needed for robust interactions, not a wholesale design-system replacement.

### Step B — Board data and interaction foundation

- `pages/Work.tsx`: board query state, filters, scope, detail links.
- New focused `components/work/*` as useful: board, lane, card, movement controller/hook.
- `TaskCreateDialog.tsx`: lane-specific default status.
- `Layout.tsx`: route-specific wide board container.
- Backend task query/status endpoints: only changes needed for stable paging/sort, capability accuracy, and safe moves.
- Prove real moves, conflicts, loading, and pagination before polishing their animations.

### Step C — Tactile finish and shared detail flow

- Apply C01–C09 to Work, then propagate applicable primitives to Today, standup capture, and outcomes.
- Add the task-detail sheet without duplicating business forms.
- Extend `lib/toast.tsx` for action feedback/Undo if implemented safely.
- Verify the result at rest, hover/focus, selected, dragging, pending, success, failure, and reduced-motion states.

### Step D — Route cleanup, docs, verification

- Keep `/work` canonical. `/board?project=…` redirects to the new board with supported query context preserved.
- Preserve the existing pilot-only legacy board temporarily as a comparison/fallback; do not promote two Work boards in normal navigation. Remove it only in a deliberate follow-up once parity is verified.
- Update the README and decisions to state that Work is now Kanban. Note that this supersedes the earlier list-first decision; do not silently erase the history of that decision.
- Update screenshots and relevant Playwright coverage. Run backend tests/lint and frontend typecheck/build plus browser tests.

## 10. Definition of done

### Functional and reliability checks

- Four workflow columns by default; canceled work reachable without adding a fifth default column.
- More than 200 tasks across lanes remain fully reachable with honest totals.
- Task creation from each applicable lane uses the correct initial status and safe project/owner defaults.
- Pointer move, keyboard move, and Move to… produce the same persisted status and audit behavior.
- Read-only tasks cannot be moved by UI or API bypass.
- Stale-version conflict, offline/timeout, server rejection, and rapid repeat interactions do not silently lose or duplicate tasks.
- Undo, if offered, performs a safe real reversal and refuses to overwrite a later change.
- Move-to-Done does not close an unresolved blocker or unrelated commitment.
- Search/filter change, detail open/close, reload, and browser Back preserve understandable context.
- Project links, task deep links, and old board URLs still lead to the intended content.

### Visual and interaction checks

- The board looks materially more crafted at rest: clear surface depth, typographic hierarchy, consistent alignment, and refined controls—not merely a new background color.
- Cards have no always-visible status select or routine priority stripe/badge overload.
- Menus are never clipped by board scrolling; dragged overlays remain correctly positioned in horizontally scrolled lanes.
- No essential action is hover-only. No accidental drag when selecting text, opening details, or using a menu.
- Native scrolling remains usable on touch; a one-column mobile view is fully functional without drag.
- All animation is event-driven; the screen is still when the user is idle.
- Reduced motion is an equally understandable experience, not a broken version.
- Keyboard/screen-reader smoke tests verify pickers, segments, movement, confirmations, sheets, and status announcements.
- At 375px, 768px, 1280px, 1440px, and 200% zoom: no document-wide overflow or unreachable actions. Horizontal scroll is intentional and confined to the board where used.

### Required implementation report

Provide:

1. What changed and which reference informed each component.
2. Files/dependencies added and any backend contract changes.
3. Test commands/results and remaining limitations.
4. Screenshots of the wide board, filtered board, open task sheet, a populated mobile lane, and error state; short interaction recordings for drag, picker, and save feedback where tooling permits.
5. Confirmation that existing trust/accessibility behavior was preserved.

**Do not stop at re-enabling the legacy board or sprinkling animation over standard controls. Deliver one cohesive, tactile component family around a real, reliable Kanban workflow.**
