from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser, Pagination
from app.core.rbac import is_manager
from app.core.serializers import (
    action_item_out,
    blocker_out,
    decision_out,
    task_out,
    task_update_out,
)
from app.enums import ActionItemStatus, BlockerStatus, Priority, TaskStatus
from app.models import (
    ActionItem,
    AuditEvent,
    Blocker,
    Decision,
    Task,
    TaskUpdate,
)
from app.schemas.common import Page
from app.schemas.tasks import (
    ActionItemCreate,
    ActionItemOut,
    ActionItemPatch,
    AuditEventOut,
    BlockerCreate,
    BlockerOut,
    BlockerResolve,
    DecisionCreate,
    DecisionOut,
    TaskCreate,
    TaskDetail,
    TaskOut,
    TaskPatch,
    TaskStatusChange,
    TaskUpdateCreate,
    TaskUpdateOut,
)
from app.services import tasks as task_service

router = APIRouter(tags=["tasks"])


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
@router.get("/tasks", response_model=Page[TaskOut])
def list_tasks(
    db: DB,
    user: CurrentUser,
    pagination: Pagination,
    project_id: str | None = None,
    assignee_id: str | None = None,
    status: list[TaskStatus] | None = Query(default=None),
    priority: Priority | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    q: str | None = None,
):
    items, total = task_service.list_tasks(
        db,
        user,
        project_id=project_id,
        assignee_id=assignee_id,
        status=status,
        priority=priority,
        blocked=blocked,
        overdue=overdue,
        q=q,
        limit=pagination.limit,
        offset=pagination.offset,
    )
    return Page[TaskOut](
        items=[task_out(t) for t in items],
        total=total,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(db: DB, user: CurrentUser, payload: TaskCreate):
    return task_out(task_service.create_task(db, user, payload))


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def get_task(db: DB, user: CurrentUser, task_id: str):
    return task_service.task_detail(db, user, task_id)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def patch_task(db: DB, user: CurrentUser, task_id: str, payload: TaskPatch):
    return task_out(task_service.patch_task(db, user, task_id, payload))


@router.patch("/tasks/{task_id}/status", response_model=TaskOut)
def change_status(db: DB, user: CurrentUser, task_id: str, payload: TaskStatusChange):
    return task_out(
        task_service.patch_task(
            db,
            user,
            task_id,
            TaskPatch(status=payload.status, expected_version=payload.expected_version),
        )
    )


@router.get("/tasks/{task_id}/updates", response_model=list[TaskUpdateOut])
def task_updates(db: DB, user: CurrentUser, task_id: str):
    task = task_service.get_task(db, user, task_id)
    updates = db.scalars(
        select(TaskUpdate)
        .options(selectinload(TaskUpdate.author), selectinload(TaskUpdate.attributed_to))
        .where(TaskUpdate.task_id == task.id)
        .order_by(TaskUpdate.created_at.desc())
    ).all()
    return [task_update_out(u) for u in updates]


@router.post("/tasks/{task_id}/updates", response_model=TaskUpdateOut, status_code=201)
def add_update(db: DB, user: CurrentUser, task_id: str, payload: TaskUpdateCreate):
    return task_service.add_update_endpoint(db, user, task_id, payload)


@router.post("/tasks/{task_id}/blockers", response_model=BlockerOut, status_code=201)
def add_blocker(db: DB, user: CurrentUser, task_id: str, payload: BlockerCreate):
    if payload.task_id and payload.task_id != task_id:
        payload.task_id = task_id
    payload.task_id = task_id
    blocker = task_service.create_blocker(db, user, payload)
    return blocker_out(blocker)


@router.get("/tasks/{task_id}/activity", response_model=list[AuditEventOut])
def task_activity(db: DB, user: CurrentUser, task_id: str, limit: int = 200):
    task = task_service.get_task(db, user, task_id)
    blocker_ids = select(Blocker.id).where(Blocker.task_id == task.id)
    action_ids = select(ActionItem.id).where(ActionItem.task_id == task.id)
    decision_ids = select(Decision.id).where(Decision.task_id == task.id)
    events = db.scalars(
        select(AuditEvent)
        .where(
            or_(
                and_(AuditEvent.entity_type == "task", AuditEvent.entity_id == task.id),
                and_(
                    AuditEvent.entity_type == "blocker", AuditEvent.entity_id.in_(blocker_ids)
                ),
                and_(
                    AuditEvent.entity_type == "action_item",
                    AuditEvent.entity_id.in_(action_ids),
                ),
                and_(
                    AuditEvent.entity_type == "decision",
                    AuditEvent.entity_id.in_(decision_ids),
                ),
            )
        )
        .order_by(AuditEvent.occurred_at.desc())
        .limit(min(limit, 500))
    ).all()
    return [AuditEventOut.model_validate(e) for e in events]


# ---------------------------------------------------------------------------
# Blockers
# ---------------------------------------------------------------------------
@router.get("/blockers", response_model=Page[BlockerOut])
def list_blockers(
    db: DB,
    user: CurrentUser,
    pagination: Pagination,
    task_id: str | None = None,
    owner_id: str | None = None,
    open_only: bool = True,
):
    stmt = select(Blocker).options(
        selectinload(Blocker.task), selectinload(Blocker.owner)
    )
    if task_id:
        stmt = stmt.where(Blocker.task_id == task_id)
    if owner_id:
        stmt = stmt.where(Blocker.owner_id == owner_id)
    if open_only:
        stmt = stmt.where(Blocker.status == BlockerStatus.OPEN)
    if not is_manager(user):
        stmt = stmt.join(Task, Blocker.task_id == Task.id).where(
            or_(
                Task.assignee_id == user.id,
                Task.created_by_id == user.id,
                Blocker.owner_id == user.id,
            )
        )
    from sqlalchemy import func

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Blocker.created_at.asc())
            .limit(pagination.limit)
            .offset(pagination.offset)
        )
        .unique()
        .all()
    )
    return Page[BlockerOut](
        items=[blocker_out(b) for b in rows],
        total=total,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.patch("/blockers/{blocker_id}/resolve", response_model=BlockerOut)
def resolve_blocker(db: DB, user: CurrentUser, blocker_id: str, payload: BlockerResolve):
    return blocker_out(
        task_service.resolve_blocker(db, user, blocker_id, payload.resolution_details)
    )


# ---------------------------------------------------------------------------
# Action items
# ---------------------------------------------------------------------------
@router.get("/action-items", response_model=Page[ActionItemOut])
def list_action_items(
    db: DB,
    user: CurrentUser,
    pagination: Pagination,
    session_id: str | None = None,
    owner_id: str | None = None,
    open_only: bool = False,
):
    from sqlalchemy import func

    stmt = select(ActionItem).options(
        selectinload(ActionItem.task),
        selectinload(ActionItem.owner),
        selectinload(ActionItem.session),
    )
    if session_id:
        stmt = stmt.where(ActionItem.session_id == session_id)
    if owner_id:
        stmt = stmt.where(ActionItem.owner_id == owner_id)
    if open_only:
        stmt = stmt.where(ActionItem.status == ActionItemStatus.OPEN)
    if not is_manager(user):
        stmt = stmt.outerjoin(Task, ActionItem.task_id == Task.id).where(
            or_(
                ActionItem.owner_id == user.id,
                Task.assignee_id == user.id,
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(ActionItem.created_at.desc())
            .limit(pagination.limit)
            .offset(pagination.offset)
        )
        .unique()
        .all()
    )
    return Page[ActionItemOut](
        items=[action_item_out(a) for a in rows],
        total=total,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.post("/action-items", response_model=ActionItemOut, status_code=201)
def create_action_item(db: DB, user: CurrentUser, payload: ActionItemCreate):
    return action_item_out(task_service.create_action_item(db, user, payload))


@router.patch("/action-items/{item_id}", response_model=ActionItemOut)
def patch_action_item(db: DB, user: CurrentUser, item_id: str, payload: ActionItemPatch):
    return action_item_out(task_service.patch_action_item(db, user, item_id, payload))


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------
@router.get("/decisions", response_model=Page[DecisionOut])
def list_decisions(
    db: DB,
    user: CurrentUser,
    pagination: Pagination,
    session_id: str | None = None,
    task_id: str | None = None,
):
    from sqlalchemy import func

    stmt = select(Decision).options(
        selectinload(Decision.task),
        selectinload(Decision.decided_by),
        selectinload(Decision.responsible_user),
    )
    if session_id:
        stmt = stmt.where(Decision.session_id == session_id)
    if task_id:
        stmt = stmt.where(Decision.task_id == task_id)
    if not is_manager(user):
        stmt = stmt.where(
            or_(
                Decision.responsible_user_id == user.id,
                Decision.task_id.in_(select(Task.id).where(Task.assignee_id == user.id)),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Decision.created_at.desc())
            .limit(pagination.limit)
            .offset(pagination.offset)
        )
        .unique()
        .all()
    )
    return Page[DecisionOut](
        items=[decision_out(d) for d in rows],
        total=total,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.post("/decisions", response_model=DecisionOut, status_code=201)
def create_decision(db: DB, user: CurrentUser, payload: DecisionCreate):
    return decision_out(task_service.create_decision(db, user, payload))


@router.get("/tasks/{task_id}/history", response_model=list[TaskUpdateOut])
def task_history(db: DB, user: CurrentUser, task_id: str):
    """Progress-update history for a task (answers: how did it progress?)."""
    task = task_service.get_task(db, user, task_id)
    updates = db.scalars(
        select(TaskUpdate)
        .options(selectinload(TaskUpdate.author), selectinload(TaskUpdate.attributed_to))
        .where(TaskUpdate.task_id == task.id)
        .order_by(TaskUpdate.created_at.desc())
    ).all()
    return [task_update_out(u) for u in updates]

