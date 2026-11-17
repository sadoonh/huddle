"""The pre-meeting check-in projection of the shared task universe.

Today is not a parallel store: it queries the same Task rows, applies one
relevance rule, and returns paginated data for the check-in table.
"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.rbac import can_edit_task, is_manager
from app.core.serializers import task_out, workspace_task
from app.enums import SessionStatus, TaskStatus
from app.models import StandupSession, Task, User, utcnow
from app.schemas.common import Page
from app.schemas.tasks import TaskOut
from app.schemas.today import AttentionItem, TodayOut, TodaySession, TodayTask
from app.services.attention import (
    attention_score,
    blocked_text_filter,
    exception_reasons,
    task_query,
)
from app.services.daily_updates import get_today as get_daily_update


def _session_summary(db: Session, user: User) -> tuple[StandupSession | None, TodaySession | None]:
    session = db.scalar(
        select(StandupSession)
        .options(selectinload(StandupSession.participants))
        .where(StandupSession.session_date == date.today())
    )
    if session is None:
        return None, None
    visible = is_manager(user) or any(
        participant.user_id == user.id for participant in session.participants
    )
    if not visible:
        return session, None
    return session, TodaySession(
        id=session.id,
        session_date=session.session_date,
        status=session.status,
        facilitator=session.facilitator,
        reviewed_count=sum(
            1 for participant in session.participants if participant.reviewed_at
        ),
        participant_count=len(session.participants),
    )


def _cutoff_label(cutoff: datetime, previous: StandupSession | None) -> str:
    if previous is not None:
        day = previous.session_date
        return f"Since the {day.strftime('%b')} {day.day} standup"
    return "Since the start of today"


def _visibility(user: User, assignee_id: str | None = None):
    if not is_manager(user):
        return [Task.assignee_id == user.id]
    if assignee_id:
        return [Task.assignee_id == assignee_id]
    return []


def _relevance():
    """Active check-in relevance: open work, or blocked (free text) and not closed.

    Due dates, at-risk flags, action items and legacy Blocker rows never widen
    or narrow this set anymore.
    """
    closed = TaskStatus.closed_statuses()
    return or_(
        Task.status.in_([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
        (blocked_text_filter()) & (Task.status.notin_(closed)),
    )


def build_checkin(
    db: Session,
    user: User,
    *,
    cutoff: datetime,
    q: str | None = None,
    assignee_id: str | None = None,
) -> list[tuple[Task, object]]:
    stmt = task_query().where(*_visibility(user, assignee_id), _relevance())
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Task.title.ilike(term), Task.public_id.ilike(term)))
    tasks = list(db.scalars(stmt).unique().all())

    rows = []
    for task in tasks:
        reasons = exception_reasons(task)
        score = attention_score(reasons)
        out = TodayTask(**workspace_task(task).model_dump())
        out.can_move = can_edit_task(user, task)
        rows.append((task, out, score))
    # Date-free ordering: attention first, then most recently touched, with a
    # stable UUID tie-break.
    rows.sort(
        key=lambda row: (
            -row[2],
            -row[0].updated_at.timestamp(),
            row[0].title.lower(),
            row[0].id,
        )
    )
    return [(task, out) for task, out, _score in rows]


def build_other_commitments(
    db: Session, user: User, *, represented_task_ids: set[str]
) -> list[AttentionItem]:
    """Legacy help/follow-up rows are no longer part of the active check-in."""
    return []


def build_recently_completed(
    db: Session,
    user: User,
    *,
    cutoff: datetime,
    q: str | None = None,
    assignee_id: str | None = None,
    limit: int = 10,
) -> Page[TaskOut]:
    stmt = task_query().where(
        *_visibility(user, assignee_id),
        Task.status == TaskStatus.DONE,
        Task.completed_at.is_not(None),
        Task.completed_at >= cutoff,
    )
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Task.title.ilike(term), Task.public_id.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Task.completed_at.desc(), Task.id.asc()).limit(limit)
        )
        .unique()
        .all()
    )
    return Page[TaskOut](
        items=[task_out(task, user) for task in rows],
        total=total,
        limit=limit,
        offset=0,
    )


def build_today(
    db: Session,
    user: User,
    *,
    limit: int = 25,
    offset: int = 0,
    q: str | None = None,
    assignee_id: str | None = None,
    recent_limit: int = 10,
) -> TodayOut:
    session, session_summary = _session_summary(db, user)

    previous = db.scalar(
        select(StandupSession)
        .where(
            StandupSession.status == SessionStatus.COMPLETED,
            StandupSession.ended_at.is_not(None),
            StandupSession.ended_at <= utcnow(),
        )
        .order_by(StandupSession.ended_at.desc())
    )
    cutoff = previous.ended_at if previous and previous.ended_at else datetime.combine(
        date.today(), time.min
    )
    cutoff_label = _cutoff_label(cutoff, previous)

    all_rows = build_checkin(
        db, user, cutoff=cutoff, q=q, assignee_id=assignee_id
    )
    total = len(all_rows)
    page_rows = all_rows[offset : offset + limit]
    represented = {task.id for task, _out in all_rows}

    return TodayOut(
        business_date=date.today(),
        session=session_summary,
        daily_update=get_daily_update(db, user),
        cutoff=cutoff,
        cutoff_label=cutoff_label,
        checkin=Page(
            items=[out for _task, out in page_rows],
            total=total,
            limit=limit,
            offset=offset,
        ),
        other_commitments=build_other_commitments(
            db, user, represented_task_ids=represented
        ),
        recently_completed=build_recently_completed(
            db,
            user,
            cutoff=cutoff,
            q=q,
            assignee_id=assignee_id,
            limit=recent_limit,
        ),
    )
