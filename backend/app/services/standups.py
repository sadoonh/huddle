"""Daily standup lifecycle and the three-panel workspace data.

Carry-forward is *query driven* rather than copied: an open blocker or action
item stays attached to its originating session and keeps appearing in every
subsequent session until it is explicitly resolved. This is why ending a
session can never erase an open commitment.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ConflictError, DomainValidationError, ForbiddenError, NotFoundError
from app.core.rbac import (
    ensure_session_visible,
    ensure_task_visible,
    get_task_or_404,
    get_user_or_404,
    is_manager,
    require_manager,
)
from app.core.serializers import (
    action_item_out,
    audit_out,
    blocker_out,
    carried_action_item,
    carried_blocker,
    decision_out,
    participant_out,
    session_counts,
    session_out,
    summary_out,
    task_out,
    task_update_out,
    user_brief,
    workspace_task,
)
from app.enums import (
    ActionItemStatus,
    AuditSource,
    BlockerStatus,
    Role,
    SessionStatus,
    TaskStatus,
    UpdateSource,
)
from app.models import (
    ActionItem,
    Blocker,
    DailyUpdate,
    Decision,
    SessionNote,
    StandupParticipant,
    StandupSession,
    Task,
    TaskUpdate,
    User,
    utcnow,
)
from app.schemas.standups import (
    CarryForwardOut,
    MeetingActionItemCreate,
    MeetingBlockerCreate,
    MeetingDecisionCreate,
    ParticipantPatch,
    ParticipantWorkspace,
    PreMeetingSubmit,
    SessionCaptures,
    SessionCreate,
    SessionDetail,
    SessionHistoryEntry,
    SessionNoteOut,
    SessionOutcomes,
    SessionSummaryOut,
    UserStandupHistory,
)
from app.schemas.tasks import (
    ActionItemCreate,
    BlockerCreate,
    DecisionCreate,
    TaskPatch,
    TaskUpdateCreate,
)
from app.schemas.today import DailyUpdateOut
from app.services.attention import blocked_text_filter, is_blocked_text, task_query
from app.services.audit import record_event
from app.services.daily_updates import get_for_user_date
from app.services.tasks import (
    add_task_update,
    create_action_item,
    create_blocker,
    create_decision,
    patch_task,
    resolve_blocker,
    visible_task_filter,
)


# ---------------------------------------------------------------------------
# Lookups and lifecycle
# ---------------------------------------------------------------------------
def get_session_or_404(db: Session, session_id: str) -> StandupSession:
    session = db.get(StandupSession, session_id)
    if session is None:
        raise NotFoundError("Standup session not found")
    return session


def _default_participant_ids(db: Session) -> list[str]:
    rows = db.scalars(
        select(User)
        .where(
            User.is_active.is_(True),
            User.standup_eligible.is_(True),
            User.role != Role.ADMIN,
        )
        .order_by(User.full_name.asc())
    ).all()
    return [u.id for u in rows]


def create_session(db: Session, user: User, payload: SessionCreate) -> SessionDetail:
    require_manager(user)
    session_date = payload.session_date or date.today()

    existing = db.scalar(select(StandupSession).where(StandupSession.session_date == session_date))
    if existing:
        raise ConflictError(
            "A standup session already exists for this date",
            details={"session_id": existing.id, "status": existing.status.value},
        )

    facilitator_id = payload.facilitator_id or user.id
    get_user_or_404(db, facilitator_id)

    participant_ids = payload.participant_ids or _default_participant_ids(db)
    for participant_id in participant_ids:
        get_user_or_404(db, participant_id)

    session = StandupSession(
        session_date=session_date,
        status=SessionStatus.DRAFT,
        facilitator_id=facilitator_id,
    )
    db.add(session)
    db.flush()

    for participant_id in dict.fromkeys(participant_ids):
        db.add(StandupParticipant(session_id=session.id, user_id=participant_id))
    db.flush()

    record_event(
        db,
        event_type="standup.created",
        entity_type="standup_session",
        entity_id=session.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        session_id=session.id,
        new={
            "session_date": session_date.isoformat(),
            "participant_ids": list(dict.fromkeys(participant_ids)),
        },
    )
    db.refresh(session)
    return session_detail(db, user, session.id)


def list_sessions(
    db: Session,
    user: User,
    *,
    status: SessionStatus | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = 30,
    offset: int = 0,
) -> tuple[list, int]:
    stmt = select(StandupSession)
    if status:
        stmt = stmt.where(StandupSession.status == status)
    if start:
        stmt = stmt.where(StandupSession.session_date >= start)
    if end:
        stmt = stmt.where(StandupSession.session_date <= end)
    if not is_manager(user):
        stmt = stmt.join(StandupParticipant).where(StandupParticipant.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    sessions = list(
        db.scalars(
            stmt.order_by(StandupSession.session_date.desc()).limit(limit).offset(offset)
        )
        .unique()
        .all()
    )
    counts = session_counts(db, [s.id for s in sessions])
    items = [
        session_out(
            s,
            open_blocker_count=counts.get(s.id, (0, 0))[0],
            open_action_item_count=counts.get(s.id, (0, 0))[1],
        )
        for s in sessions
    ]
    return items, total


def session_detail(db: Session, user: User, session_id: str) -> SessionDetail:
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    counts = session_counts(db, [session.id]).get(session.id, (0, 0))
    base = session_out(
        session, open_blocker_count=counts[0], open_action_item_count=counts[1]
    )
    participants = sorted(session.participants, key=lambda p: p.user.full_name.lower())
    blocker_counts, action_counts = _per_participant_open_counts(
        db, [p.user_id for p in participants]
    )
    daily_updates = {
        row.user_id: row
        for row in db.scalars(
            select(DailyUpdate).where(
                DailyUpdate.user_id.in_([p.user_id for p in participants]),
                DailyUpdate.update_date == session.session_date,
            )
        ).all()
    }
    return SessionDetail(
        **base.model_dump(),
        participants=[
            participant_out(
                p,
                open_blocker_count=blocker_counts.get(p.user_id, 0),
                open_action_item_count=action_counts.get(p.user_id, 0),
                has_daily_update=p.user_id in daily_updates,
                daily_update=daily_updates.get(p.user_id),
            )
            for p in participants
        ],
    )


def _per_participant_open_counts(
    db: Session, user_ids: list[str]
) -> tuple[dict[str, int], dict[str, int]]:
    """Open blockers/action items per employee, in two aggregate queries."""
    blocker_counts = {user_id: 0 for user_id in user_ids}
    action_counts = {user_id: 0 for user_id in user_ids}
    if not user_ids:
        return blocker_counts, action_counts

    blockers = db.execute(
        select(Blocker.id, Blocker.owner_id, Task.assignee_id)
        .outerjoin(Task, Blocker.task_id == Task.id)
        .where(
            Blocker.status == BlockerStatus.OPEN,
            or_(Blocker.owner_id.in_(user_ids), Task.assignee_id.in_(user_ids)),
        )
    ).all()
    seen: dict[str, set[str]] = {user_id: set() for user_id in user_ids}
    for blocker_id, owner_id, assignee_id in blockers:
        for user_id in (owner_id, assignee_id):
            if user_id in seen:
                seen[user_id].add(blocker_id)
    for user_id, ids in seen.items():
        blocker_counts[user_id] = len(ids)

    actions = db.execute(
        select(ActionItem.owner_id, func.count(ActionItem.id))
        .where(
            ActionItem.status == ActionItemStatus.OPEN,
            ActionItem.owner_id.in_(user_ids),
        )
        .group_by(ActionItem.owner_id)
    ).all()
    for owner_id, count in actions:
        if owner_id in action_counts:
            action_counts[owner_id] = count
    return blocker_counts, action_counts


def get_today(db: Session, user: User) -> SessionDetail | None:
    session = db.scalar(select(StandupSession).where(StandupSession.session_date == date.today()))
    if session is None:
        return None
    ensure_session_visible(user, session)
    return session_detail(db, user, session.id)


def start_session(db: Session, user: User, session_id: str) -> SessionDetail:
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is already completed")
    if session.status == SessionStatus.IN_PROGRESS:
        return session_detail(db, user, session.id)
    session.status = SessionStatus.IN_PROGRESS
    session.started_at = utcnow()
    db.flush()
    record_event(
        db,
        event_type="standup.started",
        entity_type="standup_session",
        entity_id=session.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        session_id=session.id,
    )
    return session_detail(db, user, session.id)


def _session_counts_for_summary(db: Session, session_id: str) -> dict[str, int]:
    updates = db.scalar(
        select(func.count(TaskUpdate.id)).where(TaskUpdate.session_id == session_id)
    )
    blockers_created = db.scalar(
        select(func.count(Blocker.id)).where(Blocker.reported_session_id == session_id)
    )
    blockers_resolved = db.scalar(
        select(func.count(Blocker.id)).where(Blocker.resolved_session_id == session_id)
    )
    decisions = db.scalar(
        select(func.count(Decision.id)).where(Decision.session_id == session_id)
    )
    action_items = db.scalar(
        select(func.count(ActionItem.id)).where(ActionItem.session_id == session_id)
    )
    open_action_items = db.scalar(
        select(func.count(ActionItem.id)).where(
            ActionItem.session_id == session_id, ActionItem.status == ActionItemStatus.OPEN
        )
    )
    return {
        "updates": updates or 0,
        "blockers_created": blockers_created or 0,
        "blockers_resolved": blockers_resolved or 0,
        "decisions": decisions or 0,
        "action_items": action_items or 0,
        "open_action_items": open_action_items or 0,
    }


def summary(db: Session, user: User, session_id: str) -> SessionSummaryOut:
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    counts = _session_counts_for_summary(db, session.id)
    text = _summary_text(db, session, counts)
    overall = session_counts(db, [session.id]).get(session.id, (0, 0))
    base = session_out(
        session, open_blocker_count=overall[0], open_action_item_count=overall[1]
    )
    return summary_out(
        session,
        updates=counts["updates"],
        blockers_created=counts["blockers_created"],
        blockers_resolved=counts["blockers_resolved"],
        decisions=counts["decisions"],
        action_items=counts["action_items"],
        open_action_items=counts["open_action_items"],
        summary_text=text,
        session_schema=base,
    )


def _summary_text(db: Session, session: StandupSession, counts: dict[str, int]) -> str:
    reviewed = sum(1 for p in session.participants if p.reviewed_at is not None)
    total = len(session.participants)
    unreviewed = [p.user.full_name for p in session.participants if p.reviewed_at is None]
    lines = [
        f"Standup {session.session_date.isoformat()} — {reviewed}/{total} participants reviewed."
    ]
    if counts["updates"]:
        lines.append(f"{counts['updates']} progress update(s) recorded.")
    if counts["decisions"]:
        lines.append(f"{counts['decisions']} decision(s) recorded.")
    if unreviewed:
        lines.append(f"Not reviewed: {', '.join(unreviewed)}.")
    return " ".join(lines)


def complete_session(
    db: Session, user: User, session_id: str, *, notes: str | None = None, force: bool = False
) -> SessionSummaryOut:
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is already completed")

    unreviewed = [p for p in session.participants if p.reviewed_at is None]
    if unreviewed and not force:
        raise ConflictError(
            "Some participants have not been reviewed. Pass force=true to complete anyway.",
            details={"unreviewed_user_ids": [p.user_id for p in unreviewed]},
        )

    counts = _session_counts_for_summary(db, session.id)
    text = _summary_text(db, session, counts)

    session.status = SessionStatus.COMPLETED
    session.ended_at = utcnow()
    session.summary = text
    if notes:
        session.notes = notes.strip()
    db.flush()

    record_event(
        db,
        event_type="standup.completed",
        entity_type="standup_session",
        entity_id=session.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        session_id=session.id,
        new={
            "summary": text,
            "reviewed": len(session.participants) - len(unreviewed),
            "participants": len(session.participants),
            "counts": counts,
        },
    )
    return summary(db, user, session.id)


# ---------------------------------------------------------------------------
# Pre-meeting
# ---------------------------------------------------------------------------
def submit_pre_meeting(
    db: Session, user: User, session_id: str, user_id: str, payload: PreMeetingSubmit
) -> ParticipantWorkspace:
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    if user.id != user_id and user.role != Role.ADMIN:
        raise ForbiddenError("You can only submit your own pre-meeting update")
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("This standup is already completed")

    participant = _participant_or_404(db, session.id, user_id)
    # Pre-meeting input stays open during the live meeting until the manager
    # has reviewed that person, which makes late arrivals practical.
    if participant.reviewed_at is not None:
        raise ConflictError("Your update is closed because you were already reviewed")
    if session.status == SessionStatus.DRAFT:
        pass
    elif session.status != SessionStatus.IN_PROGRESS:
        raise ConflictError("Pre-meeting updates are closed for this session")
    previous = {
        "progress": participant.pre_meeting_progress,
        "next_steps": participant.pre_meeting_next_steps,
        "blockers": participant.pre_meeting_blockers,
    }

    if payload.progress is not None:
        participant.pre_meeting_progress = payload.progress.strip() or None
    if payload.next_steps is not None:
        participant.pre_meeting_next_steps = payload.next_steps.strip() or None
    if payload.blockers is not None:
        participant.pre_meeting_blockers = payload.blockers.strip() or None
    participant.pre_meeting_submitted_at = utcnow()

    created_updates: list[str] = []
    for task_update in payload.task_updates:
        task = get_task_or_404(db, task_update.task_id)
        if task.assignee_id != user_id and user.role != Role.ADMIN:
            raise DomainValidationError(
                "Pre-meeting updates can only be linked to tasks assigned to you"
            )
        update = add_task_update(
            db,
            user,
            task,
            TaskUpdateCreate(
                progress=task_update.progress,
                next_steps=task_update.next_steps,
                attributed_to_user_id=user_id,
            ),
            session_id=session.id,
            source=UpdateSource.PRE_MEETING,
            audit_source=AuditSource.EMPLOYEE_UPDATE,
        )
        created_updates.append(update.id)

    db.flush()
    record_event(
        db,
        event_type="pre_meeting.submitted",
        entity_type="standup_participant",
        entity_id=participant.id,
        actor=user,
        source=AuditSource.EMPLOYEE_UPDATE,
        session_id=session.id,
        previous=previous,
        new={
            "progress": participant.pre_meeting_progress,
            "next_steps": participant.pre_meeting_next_steps,
            "blockers": participant.pre_meeting_blockers,
            "task_update_ids": created_updates,
        },
    )
    return build_workspace(db, user, session.id, user_id)


def _participant_or_404(db: Session, session_id: str, user_id: str) -> StandupParticipant:
    participant = db.scalar(
        select(StandupParticipant).where(
            StandupParticipant.session_id == session_id,
            StandupParticipant.user_id == user_id,
        )
    )
    if participant is None:
        raise NotFoundError("User is not a participant in this session")
    return participant


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------
def _updated(card) -> float:
    """Sort key: most recently touched first, no date-related fields."""
    return card.updated_at.timestamp()


def build_workspace(
    db: Session, user: User, session_id: str, user_id: str
) -> ParticipantWorkspace:
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    participant = _participant_or_404(db, session.id, user_id)
    get_user_or_404(db, user_id)

    tasks = list(
        db.scalars(
            select(Task)
            .options(
                selectinload(Task.project),
                selectinload(Task.assignee),
                selectinload(Task.updates),
                selectinload(Task.blockers),
                selectinload(Task.action_items),
            )
            .where(Task.assignee_id == user_id)
            .order_by(Task.updated_at.desc())
        )
        .unique()
        .all()
    )

    needs_attention: list = []
    active: list = []
    other: list = []

    for task in tasks:
        card = workspace_task(task)
        if is_blocked_text(task) and task.status not in TaskStatus.closed_statuses():
            needs_attention.append(card)
        elif task.status in (TaskStatus.TODO, TaskStatus.IN_PROGRESS):
            active.append(card)
        else:
            other.append(card)

    # Date-free ordering with stable UUID tie-breaks.
    needs_attention.sort(key=lambda t: (-_updated(t), t.title.lower(), t.id))

    def _active_key(t):
        return (
            0 if t.status == TaskStatus.TODO else 1,
            -_updated(t),
            t.title.lower(),
            t.id,
        )

    active.sort(key=_active_key)
    other.sort(key=lambda t: (t.status.value, -_updated(t), t.title.lower(), t.id))

    daily = get_for_user_date(db, user_id, session.session_date)

    recent_updates = list(
        db.scalars(
            select(TaskUpdate)
            .options(
                selectinload(TaskUpdate.author),
                selectinload(TaskUpdate.attributed_to),
            )
            .join(Task, TaskUpdate.task_id == Task.id)
            .where(
                or_(
                    Task.assignee_id == user_id,
                    TaskUpdate.attributed_to_user_id == user_id,
                )
            )
            .order_by(TaskUpdate.created_at.desc())
            .limit(15)
        ).all()
    )
    recent_decisions = list(
        db.scalars(
            select(Decision)
            .options(
                selectinload(Decision.task),
                selectinload(Decision.decided_by),
                selectinload(Decision.responsible_user),
            )
            .where(
                or_(
                    Decision.responsible_user_id == user_id,
                    Decision.task_id.in_(
                        select(Task.id).where(Task.assignee_id == user_id)
                    ),
                )
            )
            .order_by(Decision.created_at.desc())
            .limit(5)
        ).all()
    )

    return ParticipantWorkspace(
        session_id=session.id,
        participant=participant_out(
            participant,
            open_blocker_count=0,
            open_action_item_count=0,
            has_daily_update=daily is not None,
            daily_update=daily,
        ),
        daily_update=DailyUpdateOut.model_validate(daily) if daily else None,
        needs_attention=needs_attention,
        active=active,
        other=other,
        # Legacy carry-forward is historical only; active attention is task text.
        carried_blockers=[],
        carried_action_items=[],
        recent_updates=[task_update_out(u) for u in recent_updates],
        recent_decisions=[decision_out(d) for d in recent_decisions],
    )


def _carried_blockers(db: Session, user_id: str) -> list[Blocker]:
    stmt = (
        select(Blocker)
        .options(
            selectinload(Blocker.task),
            selectinload(Blocker.owner),
            selectinload(Blocker.reported_session),
        )
        .outerjoin(Task, Blocker.task_id == Task.id)
        .where(
            Blocker.status == BlockerStatus.OPEN,
            or_(
                Blocker.owner_id == user_id,
                Blocker.reported_by_id == user_id,
                Task.assignee_id == user_id,
            ),
        )
        .order_by(Blocker.created_at.asc())
    )
    return list(db.scalars(stmt).unique().all())


def _carried_actions(db: Session, user_id: str) -> list[ActionItem]:
    stmt = (
        select(ActionItem)
        .options(
            selectinload(ActionItem.task),
            selectinload(ActionItem.owner),
            selectinload(ActionItem.session),
        )
        .outerjoin(Task, ActionItem.task_id == Task.id)
        .where(
            ActionItem.status == ActionItemStatus.OPEN,
            or_(
                ActionItem.owner_id == user_id,
                (ActionItem.owner_id.is_(None)) & (Task.assignee_id == user_id),
            ),
        )
        .order_by(ActionItem.created_at.asc())
    )
    return list(db.scalars(stmt).unique().all())


# ---------------------------------------------------------------------------
# In-meeting capture
# ---------------------------------------------------------------------------
def capture_progress(
    db: Session, user: User, session_id: str, payload
):
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is completed; reopen is not supported")
    task = get_task_or_404(db, payload.task_id)
    ensure_task_visible(user, task)

    update_payload: dict = {
        "progress": payload.progress,
        "next_steps": payload.next_steps,
        "attributed_to_user_id": payload.attributed_to_user_id or task.assignee_id,
        "status": payload.status,
        "expected_version": payload.expected_version,
        "client_operation_id": payload.client_operation_id,
    }
    update = add_task_update(
        db,
        user,
        task,
        TaskUpdateCreate(**update_payload),
        session_id=session.id,
        source=UpdateSource.STANDUP,
        audit_source=AuditSource.MANAGER_ACTION,
    )
    return task_update_out(update)


def capture_blocker(db: Session, user: User, session_id: str, payload: MeetingBlockerCreate):
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is completed")
    blocker = create_blocker(
        db,
        user,
        BlockerCreate(
            description=payload.description,
            task_id=payload.task_id,
            owner_id=payload.owner_id,
            client_operation_id=payload.client_operation_id,
        ),
        session_id=session.id,
        audit_source=AuditSource.MANAGER_ACTION,
    )
    return blocker_out(blocker)


def capture_action_item(
    db: Session, user: User, session_id: str, payload: MeetingActionItemCreate
):
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is completed")
    item = create_action_item(
        db,
        user,
        ActionItemCreate(
            description=payload.description,
            owner_id=payload.owner_id,
            task_id=payload.task_id,
            due_date=payload.due_date,
            client_operation_id=payload.client_operation_id,
        ),
        session_id=session.id,
        audit_source=AuditSource.MANAGER_ACTION,
    )
    return action_item_out(item)


def capture_decision(db: Session, user: User, session_id: str, payload: MeetingDecisionCreate):
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is completed")
    decision = create_decision(
        db,
        user,
        DecisionCreate(
            description=payload.description,
            task_id=payload.task_id,
            project_id=payload.project_id,
            rationale=payload.rationale,
            responsible_user_id=payload.responsible_user_id,
            client_operation_id=payload.client_operation_id,
        ),
        session_id=session.id,
        audit_source=AuditSource.MANAGER_ACTION,
    )
    return decision_out(decision)


def capture_note(
    db: Session,
    user: User,
    session_id: str,
    body: str,
    client_operation_id: str | None = None,
) -> SessionNoteOut:
    require_manager(user)
    session = get_session_or_404(db, session_id)
    if client_operation_id:
        existing = db.scalar(
            select(SessionNote).where(
                SessionNote.client_operation_id == client_operation_id
            )
        )
        if existing is not None:
            if existing.author_id != user.id or existing.session_id != session.id:
                raise ConflictError(
                    "This operation id was already used for a different note."
                )
            return SessionNoteOut.model_validate(existing)
    note = SessionNote(
        session_id=session.id,
        author_id=user.id,
        body=body.strip(),
        client_operation_id=client_operation_id,
    )
    db.add(note)
    db.flush()
    record_event(
        db,
        event_type="standup.note_added",
        entity_type="standup_session",
        entity_id=session.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        session_id=session.id,
        new={"note_id": note.id, "body": note.body},
    )
    return SessionNoteOut.model_validate(note)


def resolve_blocker_in_session(
    db: Session, user: User, session_id: str, blocker_id: str, details: str
):
    require_manager(user)
    session = get_session_or_404(db, session_id)
    blocker = resolve_blocker(
        db,
        user,
        blocker_id,
        details,
        session_id=session.id,
        audit_source=AuditSource.MANAGER_ACTION,
    )
    return blocker_out(blocker)


def capture_task_status(
    db: Session, user: User, session_id: str, task_id: str, status: TaskStatus
):
    require_manager(user)
    session = get_session_or_404(db, session_id)
    task = patch_task(
        db,
        user,
        task_id,
        TaskPatch(status=status),
        session_id=session.id,
        audit_source=AuditSource.MANAGER_ACTION,
    )
    return task_out(task)


def patch_participant(
    db: Session, user: User, session_id: str, user_id: str, payload: ParticipantPatch
) -> ParticipantWorkspace:
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    if not is_manager(user):
        raise ForbiddenError("Only managers can review participants")
    if session.status == SessionStatus.COMPLETED:
        raise ConflictError("Session is completed")
    participant = _participant_or_404(db, session.id, user_id)
    changes = payload.model_dump(exclude_unset=True)
    previous = {
        "reviewed_at": participant.reviewed_at.isoformat() if participant.reviewed_at else None,
        "follow_up_flagged": participant.follow_up_flagged,
        "follow_up_note": participant.follow_up_note,
    }
    if "reviewed" in changes and changes["reviewed"] is not None:
        participant.reviewed_at = utcnow() if changes["reviewed"] else None
        participant.reviewed_by_id = user.id if changes["reviewed"] else None
    if "follow_up_flagged" in changes and changes["follow_up_flagged"] is not None:
        participant.follow_up_flagged = changes["follow_up_flagged"]
    if "follow_up_note" in changes:
        participant.follow_up_note = changes["follow_up_note"]
    db.flush()
    record_event(
        db,
        event_type="participant.reviewed" if changes.get("reviewed") else "participant.updated",
        entity_type="standup_participant",
        entity_id=participant.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        session_id=session.id,
        previous=previous,
        new={
            "reviewed_at": participant.reviewed_at.isoformat()
            if participant.reviewed_at
            else None,
            "follow_up_flagged": participant.follow_up_flagged,
            "follow_up_note": participant.follow_up_note,
        },
    )
    return build_workspace(db, user, session.id, user_id)


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
def session_captures(db: Session, user: User, session_id: str) -> SessionCaptures:
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)

    updates = list(
        db.scalars(
            select(TaskUpdate)
            .options(selectinload(TaskUpdate.author), selectinload(TaskUpdate.attributed_to))
            .where(TaskUpdate.session_id == session.id)
            .order_by(TaskUpdate.created_at.asc())
        ).all()
    )
    blockers = list(
        db.scalars(
            select(Blocker)
            .options(
                selectinload(Blocker.task),
                selectinload(Blocker.owner),
                selectinload(Blocker.reported_by),
            )
            .where(
                or_(
                    Blocker.reported_session_id == session.id,
                    Blocker.resolved_session_id == session.id,
                )
            )
            .order_by(Blocker.created_at.asc())
        )
        .unique()
        .all()
    )
    action_items = list(
        db.scalars(
            select(ActionItem)
            .options(selectinload(ActionItem.task), selectinload(ActionItem.owner))
            .where(ActionItem.session_id == session.id)
            .order_by(ActionItem.created_at.asc())
        ).all()
    )
    decisions = list(
        db.scalars(
            select(Decision)
            .options(
                selectinload(Decision.task),
                selectinload(Decision.decided_by),
                selectinload(Decision.responsible_user),
            )
            .where(Decision.session_id == session.id)
            .order_by(Decision.created_at.asc())
        ).all()
    )
    notes = list(
        db.scalars(
            select(SessionNote)
            .where(SessionNote.session_id == session.id)
            .order_by(SessionNote.created_at.asc())
        ).all()
    )
    return SessionCaptures(
        updates=[task_update_out(u) for u in updates],
        blockers=[blocker_out(b) for b in blockers],
        action_items=[action_item_out(a) for a in action_items],
        decisions=[decision_out(d) for d in decisions],
        notes=[SessionNoteOut.model_validate(n) for n in notes],
    )


def session_outcomes(db: Session, user: User, session_id: str) -> SessionOutcomes:
    """Active outcomes: recorded updates, decisions and currently blocked tasks.

    Legacy action-item/unresolved-blocker arrays remain in the contract for old
    links but are always empty; the rows are still stored and served by the
    legacy captures/history endpoints.
    """
    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    participant_ids = [participant.user_id for participant in session.participants]

    updates = list(
        db.scalars(
            select(TaskUpdate)
            .options(
                selectinload(TaskUpdate.task),
                selectinload(TaskUpdate.author),
                selectinload(TaskUpdate.attributed_to),
            )
            .where(TaskUpdate.session_id == session.id)
            .order_by(TaskUpdate.created_at.asc(), TaskUpdate.id.asc())
        )
        .unique()
        .all()
    )
    decisions = list(
        db.scalars(
            select(Decision)
            .options(
                selectinload(Decision.task),
                selectinload(Decision.decided_by),
                selectinload(Decision.responsible_user),
            )
            .where(Decision.session_id == session.id)
            .order_by(Decision.created_at.asc())
        ).all()
    )

    blocked_stmt = task_query().where(
        Task.assignee_id.in_(participant_ids),
        Task.status.notin_(TaskStatus.closed_statuses()),
        blocked_text_filter(),
    )
    if not is_manager(user):
        blocked_stmt = visible_task_filter(blocked_stmt, user)
    blocked_tasks = list(
        db.scalars(
            blocked_stmt.order_by(Task.updated_at.desc(), Task.id.asc())
        )
        .unique()
        .all()
    )

    return SessionOutcomes(
        action_items=[],
        unresolved_blockers=[],
        decisions=[decision_out(decision) for decision in decisions],
        updates=[task_update_out(update) for update in updates],
        blocked_tasks=[task_out(task, user) for task in blocked_tasks],
        updates_count=len(updates),
        participant_count=len(session.participants),
        reviewed_count=sum(1 for p in session.participants if p.reviewed_at),
    )


def session_timeline(db: Session, user: User, session_id: str) -> list:
    from app.models import AuditEvent

    session = get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    events = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.session_id == session.id)
        .order_by(AuditEvent.occurred_at.asc())
    ).all()
    return [audit_out(e) for e in events]


def user_history(
    db: Session,
    requester: User,
    user_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    limit: int = 30,
) -> UserStandupHistory:
    target = get_user_or_404(db, user_id)
    if not is_manager(requester) and requester.id != user_id:
        raise ForbiddenError("You can only view your own standup history")

    stmt = (
        select(StandupSession)
        .join(StandupParticipant)
        .where(StandupParticipant.user_id == user_id)
        .order_by(StandupSession.session_date.desc())
        .limit(limit)
    )
    if start:
        stmt = stmt.where(StandupSession.session_date >= start)
    if end:
        stmt = stmt.where(StandupSession.session_date <= end)
    sessions = list(db.scalars(stmt).unique().all())

    entries: list[SessionHistoryEntry] = []
    for session in sessions:
        participant = _participant_or_404(db, session.id, user_id)
        updates = list(
            db.scalars(
                select(TaskUpdate)
                .options(
                    selectinload(TaskUpdate.author),
                    selectinload(TaskUpdate.attributed_to),
                )
                .where(
                    TaskUpdate.session_id == session.id,
                    or_(
                        TaskUpdate.attributed_to_user_id == user_id,
                        TaskUpdate.author_id == user_id,
                    ),
                )
                .order_by(TaskUpdate.created_at.asc())
            ).all()
        )
        blockers_reported = list(
            db.scalars(
                select(Blocker)
                .options(selectinload(Blocker.task), selectinload(Blocker.owner))
                .where(Blocker.reported_session_id == session.id)
                .order_by(Blocker.created_at.asc())
            ).all()
        )
        blockers_resolved = list(
            db.scalars(
                select(Blocker)
                .options(selectinload(Blocker.task), selectinload(Blocker.owner))
                .where(Blocker.resolved_session_id == session.id)
                .order_by(Blocker.created_at.asc())
            ).all()
        )
        decisions = list(
            db.scalars(
                select(Decision)
                .options(selectinload(Decision.task))
                .where(
                    Decision.session_id == session.id,
                    or_(
                        Decision.responsible_user_id == user_id,
                        Decision.task_id.in_(select(Task.id).where(Task.assignee_id == user_id)),
                    ),
                )
                .order_by(Decision.created_at.asc())
            ).all()
        )
        action_items = list(
            db.scalars(
                select(ActionItem)
                .options(selectinload(ActionItem.task), selectinload(ActionItem.owner))
                .where(ActionItem.session_id == session.id, ActionItem.owner_id == user_id)
                .order_by(ActionItem.created_at.asc())
            ).all()
        )
        overall = session_counts(db, [session.id]).get(session.id, (0, 0))
        entries.append(
            SessionHistoryEntry(
                session=session_out(
                    session,
                    open_blocker_count=overall[0],
                    open_action_item_count=overall[1],
                ),
                participant=participant_out(participant),
                updates=[task_update_out(u) for u in updates],
                blockers_reported=[blocker_out(b) for b in blockers_reported],
                blockers_resolved=[blocker_out(b) for b in blockers_resolved],
                decisions=[decision_out(d) for d in decisions],
                action_items=[action_item_out(a) for a in action_items],
            )
        )
    return UserStandupHistory(user=user_brief(target), entries=entries)


def carry_forward(db: Session, requester: User, user_id: str) -> CarryForwardOut:
    target = get_user_or_404(db, user_id)
    if not is_manager(requester) and requester.id != user_id:
        raise ForbiddenError("You can only view your own carry-forward items")

    blockers = _carried_blockers(db, target.id)
    actions = _carried_actions(db, target.id)
    tasks = list(
        db.scalars(
            select(Task)
            .options(
                selectinload(Task.project),
                selectinload(Task.assignee),
                selectinload(Task.updates),
                selectinload(Task.blockers),
                selectinload(Task.action_items),
            )
            .where(
                Task.assignee_id == target.id,
                Task.status.notin_(TaskStatus.closed_statuses()),
                Task.due_date < date.today(),
            )
            .order_by(Task.due_date.asc())
        )
        .unique()
        .all()
    )
    overdue = [task_out(t) for t in tasks if t.due_date and t.due_date < date.today()]
    return CarryForwardOut(
        blockers=[carried_blocker(b) for b in blockers],
        action_items=[carried_action_item(a) for a in actions],
        overdue_tasks=overdue,
    )
