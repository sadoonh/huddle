# Simplification pilot checklist

Use this for the two-week validation of the simplified **Today + Work + focused standup** experience. The goal is not a neat screen — it is fewer missed commitments, fewer incorrect owners, and less time spent maintaining records.

## 1. Before the pilot

Record a baseline (last 2–4 weeks where available):

- Standup duration.
- Time spent after the meeting writing up updates/actions.
- Number of carry-forward blockers/follow-ups older than 3 days.
- Number of action items without an owner.
- How often someone says “I didn’t know that changed.”
- Where people currently look first (tracker, notes, chat).

Do not collect transcript or note contents for this experiment. Aggregate timings/counts are enough.

## 2. Participants and devices

- One facilitator (manager) and 2–5 employees.
- At least one laptop session and one narrow/mobile-width session.
- At least one keyboard-only pass through Today, the meeting and Work.

## 3. Required scenarios

| # | Scenario | Pass condition |
|---|---|---|
| 1 | Employee opens Today with no session yet | Attention + current work are visible; the question “Anything changed?” is optional |
| 2 | Employee writes a general daily update | One field; saved receipt; no second standup form |
| 3 | Employee updates a task from its row | Update and optional status change happen in place; no board visit |
| 4 | Employee clicks “Needs help” without a task | A durable team-wide blocker is created and visible to the manager |
| 5 | Manager starts standup from Today | One action enters focused mode; no global navigation |
| 6 | Manager captures update/help/follow-up/decision | Drawer keeps person/task context; one field initially; saved confirmation |
| 7 | Manager switches person with an unsaved draft | Prompt to discard; no text is attached to the wrong person |
| 8 | Manager skips an unreviewed person and finishes | Explicit override is required; names are shown |
| 9 | Manager opens Past standups and a session | Outcomes (actions/help/decisions) appear first; bookkeeping is collapsed |
| 10 | Employee has empty work or no attention items | Empty state does not look like a loading failure |
| 11 | Long attention queue (>25 items) | “Show more” reveals the full set; total is accurate |
| 12 | Stale task edit (two tabs) | `409` surfaces; newer data is not overwritten |
| 13 | No-change day | Employee submits nothing; absence is not treated as confirmation |
| 14 | Taskless blocker appears in a later standup | Still visible until resolved; origin/age preserved |
| 15 | Work list search/filter/pagination | Full result set is reachable; no Kanban columns in default Work |

Also test:

- a person who submits nothing before the meeting;
- a follow-up owned by the manager rather than the employee;
- a blocker owned by someone who is not in the standup;
- an employee with only backlog/completed work.

## 4. Targets

These are acceptance goals for the pilot, not measured current performance.

| Test | Target |
|---|---|
| Employee identifies what needs attention | ≤5 seconds, no guidance |
| Employee posts a normal short update | ≤30 seconds, one text field |
| Manager begins/resumes today’s meeting | One action from Today |
| Facilitator records an owned follow-up | ≤15 seconds, participant context retained |
| User updates status or completes a follow-up | In place, without visiting the board/history |
| User finds a past decision | ≤30 seconds from Today |
| Default primary navigation | Two destinations |
| Live meeting layout | One main area + contextual capture, no permanent side panels |
| Data integrity | No lost blockers, duplicate commitments or wrong attribution |

## 5. Observation guide

Watch for:

- Where people pause or hunt before their first action.
- Whether anyone re-enters information already visible.
- Whether “Needs help” is used for things that are not blockers.
- Whether managers finish without reviewing people, and why.
- Whether attendees ask for the board/intake/AI links.
- Whether outcomes pages answer “what did we agree?” without opening audit.

Capture short, aggregate notes only; do not store meeting contents for analysis.

## 6. Decision points

After the pilot, decide:

1. Keep or retire **intake** — is there a real requester/approval workflow?
2. Keep or retire the **legacy board** — does anyone plan outside standups?
3. Keep or retire **transcript reconciliation** — does review cost less time than it saves?
4. Is a general update before a session required? (Current answer: yes; it is supported by `daily_updates`.)
5. What team size must the participant selector support?

Do not delete historical requests, transcripts, proposals, flags or audit data as part of this decision. Use a read-only/export/retention path.

## 7. Exit criteria

The simplified experience can replace the previous default when:

- The 15 scenarios pass in normal laptop and narrow widths.
- No critical data-integrity regression is observed.
- Facilitators do not need a second tracker/notes tool during the meeting.
- Employees do not report re-entering information.
- Outstanding commitments remain visible without the old carry-forward dashboard.

If a target fails, fix visibility or flow before removing legacy access. The legacy board and pilot tools remain reachable at `/legacy/board`, `/intake` and `/ai` during this period.
