"""Shared attention ordering for Today and the live workspace.

Keeping one definition avoids the dashboard and meeting screens disagreeing
about what is blocked, overdue, at risk or carrying a follow-up.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.rbac import is_manager
from app.core.serializers import task_out, user_brief
from app.enums import ActionItemStatus, BlockerStatus, TaskStatus
from app.models import ActionItem, Blocker, Task, User, utcnow
from app.schemas.common import Page
from app.schemas.tasks import TaskOut
from app.schemas.today import AttentionIssue, AttentionItem

REASON_SCORE = {
    "blocker": 100,
    "overdue": 80,
    "at_risk": 60,
    "follow_up": 50,
}
REASON_LABEL = {
    "blocker": "Needs help",
    "overdue": "Overdue",
    "at_risk": "At risk",
    "follow_up": "Follow-up",
}


def open_blockers(task: Task) -> list[Blocker]:
    return [blocker for blocker in task.blockers if blocker.status == BlockerStatus.OPEN]


def open_action_items(task: Task) -> list[ActionItem]:
    return [item for item in task.action_items if item.status == ActionItemStatus.OPEN]


def exception_reasons(task: Task) -> list[str]:
    reasons: list[str] = []
    if open_blockers(task):
        reasons.append("blocker")
    if task.due_date and task.due_date < date.today() and task.status not in TaskStatus.closed_statuses():
        reasons.append("overdue")
    if task.is_at_risk:
        reasons.append("at_risk")
    if open_action_items(task):
        reasons.append("follow_up")
    return reasons


def attention_score(reasons: list[str]) -> int:
    return max((REASON_SCORE.get(reason, 0) for reason in reasons), default=0)


def _age_days(created_at) -> int:
    return max((utcnow().date() - created_at.date()).days, 0)


def _task_query():
    return select(Task).options(
        selectinload(Task.project),
        selectinload(Task.assignee),
        selectinload(Task.updates),
        selectinload(Task.blockers).selectinload(Blocker.owner),
        selectinload(Task.blockers).selectinload(Blocker.reported_by),
        selectinload(Task.blockers).selectinload(Blocker.reported_session),
        selectinload(Task.action_items).selectinload(ActionItem.owner),
        selectinload(Task.action_items).selectinload(ActionItem.session),
    )


def _issue_from_blocker(blocker: Blocker) -> AttentionIssue:
    return AttentionIssue(
        kind="blocker",
        id=blocker.id,
        label="Help request",
        detail=blocker.description,
        owner=user_brief(blocker.owner),
        age_days=_age_days(blocker.created_at),
    )


def _issue_from_action(item: ActionItem) -> AttentionIssue:
    return AttentionIssue(
        kind="action_item",
        id=item.id,
        label="Follow-up",
        detail=item.description,
        owner=user_brief(item.owner),
        due_date=item.due_date,
        age_days=_age_days(item.created_at),
    )


def _scope_tasks(task_stmt, user: User):
    if is_manager(user):
        return task_stmt
    return task_stmt.where(Task.assignee_id == user.id)


def build_attention(
    db: Session,
    user: User,
    *,
    limit: int = 25,
    offset: int = 0,
) -> tuple[list[AttentionItem], int]:
    """Return one deduplicated row per exception, ordered by urgency.

    A task with a blocker, overdue date and a follow-up appears once. Taskless
    blockers/follow-ups and items on closed tasks still get their own row so
    nothing is hidden by deduplication.
    """
    tasks = list(
        db.scalars(
            _scope_tasks(
                _task_query().where(Task.status.notin_(TaskStatus.closed_statuses())),
                user,
            ).order_by(Task.updated_at.desc())
        )
        .unique()
        .all()
    )

    items: list[AttentionItem] = []
    attention_task_ids: set[str] = set()

    for task in tasks:
        reasons = exception_reasons(task)
        if not reasons:
            continue
        attention_task_ids.add(task.id)
        blockers = open_blockers(task)
        actions = open_action_items(task)
        leading = max(reasons, key=lambda reason: REASON_SCORE.get(reason, 0))

        focus_id = task.id
        reporter = None
        owner = task.assignee
        detail: str | None = None
        age = 0
        origin = None
        if leading == "blocker" and blockers:
            focus = blockers[0]
            focus_id = focus.id
            reporter = focus.reported_by
            owner = focus.owner or task.assignee
            detail = focus.description
            age = _age_days(focus.created_at)
            origin = focus.reported_session.session_date if focus.reported_session else None
        elif leading == "follow_up" and actions:
            focus = actions[0]
            focus_id = focus.id
            owner = focus.owner or task.assignee
            detail = focus.description
            age = _age_days(focus.created_at)
            origin = focus.session.session_date if focus.session else None
        elif leading == "at_risk":
            detail = task.at_risk_reason or "Flagged at risk"
        elif leading == "overdue":
            detail = f"Due {task.due_date.isoformat()}" if task.due_date else None

        issues = [_issue_from_blocker(blocker) for blocker in blockers]
        issues.extend(_issue_from_action(item) for item in actions)
        if "overdue" in reasons:
            issues.append(
                AttentionIssue(
                    kind="reason",
                    id=f"{task.id}:overdue",
                    label="Overdue",
                    detail=f"Due {task.due_date.isoformat()}" if task.due_date else None,
                    owner=user_brief(task.assignee),
                )
            )
        if "at_risk" in reasons:
            issues.append(
                AttentionIssue(
                    kind="reason",
                    id=f"{task.id}:at_risk",
                    label="At risk",
                    detail=task.at_risk_reason or "Flagged at risk",
                    owner=user_brief(task.assignee),
                )
            )

        items.append(
            AttentionItem(
                kind="task",
                id=task.id,
                task_id=task.id,
                focus_id=focus_id,
                title=task.title,
                detail=detail,
                owner=user_brief(owner),
                reporter=user_brief(reporter),
                reason=leading,
                reasons=reasons,
                issues=issues,
                due_date=task.due_date,
                age_days=age,
                task_status=task.status,
                open_blocker_count=len(blockers),
                open_action_item_count=len(actions),
                origin_session_date=origin,
            )
        )

    # Blockers that are not already represented by an attention task row:
    # team-wide blockers, blocked closed tasks, and blockers the employee owns
    # on someone else's task.
    blocker_stmt = (
        select(Blocker)
        .options(
            selectinload(Blocker.task).selectinload(Task.assignee),
            selectinload(Blocker.owner),
            selectinload(Blocker.reported_by),
            selectinload(Blocker.reported_session),
        )
        .outerjoin(Task, Blocker.task_id == Task.id)
        .where(Blocker.status == BlockerStatus.OPEN)
    )
    if not is_manager(user):
        blocker_stmt = blocker_stmt.where(
            or_(
                Blocker.owner_id == user.id,
                Blocker.reported_by_id == user.id,
                Task.assignee_id == user.id,
            )
        )
    for blocker in db.scalars(blocker_stmt).unique().all():
        if blocker.task_id and blocker.task_id in attention_task_ids:
            continue
        items.append(
            AttentionItem(
                kind="blocker",
                id=blocker.id,
                task_id=blocker.task_id,
                focus_id=blocker.id,
                title=blocker.task.title if blocker.task else "Team blocker",
                detail=blocker.description,
                owner=user_brief(blocker.owner),
                reporter=user_brief(blocker.reported_by),
                reason="blocker",
                reasons=["blocker"],
                issues=[_issue_from_blocker(blocker)],
                due_date=None,
                age_days=_age_days(blocker.created_at),
                task_status=blocker.task.status if blocker.task else None,
                open_blocker_count=1,
                origin_session_date=blocker.reported_session.session_date
                if blocker.reported_session
                else None,
            )
        )

    # Open follow-ups that are taskless or on a task not already shown.
    action_stmt = (
        select(ActionItem)
        .options(
            selectinload(ActionItem.task).selectinload(Task.assignee),
            selectinload(ActionItem.owner),
            selectinload(ActionItem.session),
        )
        .outerjoin(Task, ActionItem.task_id == Task.id)
        .where(ActionItem.status == ActionItemStatus.OPEN)
    )
    if not is_manager(user):
        action_stmt = action_stmt.where(
            or_(
                ActionItem.owner_id == user.id,
                and_(ActionItem.owner_id.is_(None), Task.assignee_id == user.id),
            )
        )
    for item in db.scalars(action_stmt).unique().all():
        if item.task_id and item.task_id in attention_task_ids:
            continue
        items.append(
            AttentionItem(
                kind="action_item",
                id=item.id,
                task_id=item.task_id,
                focus_id=item.id,
                title=item.description,
                detail=item.task.title if item.task else "General follow-up",
                owner=user_brief(item.owner),
                reason="follow_up",
                reasons=["follow_up"],
                issues=[_issue_from_action(item)],
                due_date=item.due_date,
                age_days=_age_days(item.created_at),
                task_status=item.task.status if item.task else None,
                open_action_item_count=1,
                origin_session_date=item.session.session_date if item.session else None,
            )
        )

    items.sort(
        key=lambda item: (
            -attention_score(item.reasons),
            item.due_date or date.max,
            -item.age_days,
            item.title.lower(),
        )
    )
    total = len(items)
    return items[offset : offset + limit], total


def build_current_work(db: Session, user: User, *, limit: int = 6) -> Page[TaskOut]:
    """Short personal current-work preview. Managers get their work in Work."""
    empty = Page[TaskOut](items=[], total=0, limit=limit, offset=0)
    if is_manager(user):
        return empty

    base = _task_query().where(
        Task.assignee_id == user.id,
        Task.status.in_([TaskStatus.TODO, TaskStatus.IN_PROGRESS]),
    )
    total = db.scalar(select(func.count()).select_from(base.order_by(None).subquery())) or 0
    rows = (
        db.scalars(
            base.order_by(
                Task.due_date.is_(None),
                Task.due_date.asc(),
                Task.updated_at.desc(),
            ).limit(limit)
        )
        .unique()
        .all()
    )
    return Page[TaskOut](
        items=[task_out(task) for task in rows], total=total, limit=limit, offset=0
    )
