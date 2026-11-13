"""Task, blocker, action-item and decision services.

Every mutation writes its audit event in the same session; the request-scoped
dependency commits all of it atomically.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ConflictError, DomainValidationError, ForbiddenError, NotFoundError
from app.core.rbac import (
    ensure_project_visible,
    ensure_task_editable,
    ensure_task_visible,
    get_project_or_404,
    get_task_or_404,
    get_user_or_404,
    is_manager,
)
from app.core.serializers import (
    action_item_out,
    blocker_out,
    decision_out,
    task_out,
    task_update_out,
)
from app.enums import (
    ActionItemStatus,
    AuditSource,
    BlockerStatus,
    TaskStatus,
    UpdateSource,
)
from app.models import ActionItem, Blocker, Decision, Task, TaskUpdate, User, utcnow
from app.schemas.tasks import (
    ActionItemCreate,
    ActionItemPatch,
    BlockerCreate,
    DecisionCreate,
    TaskCreate,
    TaskPatch,
    TaskUpdateCreate,
)
from app.services.audit import record_event, snapshot

_TASK_FIELDS = (
    "title",
    "description",
    "project_id",
    "assignee_id",
    "priority",
    "status",
    "due_date",
    "is_at_risk",
    "at_risk_reason",
)


def _task_query() -> Select:
    return select(Task).options(
        selectinload(Task.project),
        selectinload(Task.assignee),
        selectinload(Task.updates),
        selectinload(Task.blockers),
        selectinload(Task.action_items),
    )


def visible_task_filter(stmt: Select, user: User) -> Select:
    if is_manager(user):
        return stmt
    return stmt.where(or_(Task.assignee_id == user.id, Task.created_by_id == user.id))


def list_tasks(
    db: Session,
    user: User,
    *,
    project_id: str | None = None,
    assignee_id: str | None = None,
    status: list[TaskStatus] | None = None,
    priority: str | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[Task], int]:
    stmt = visible_task_filter(_task_query(), user)
    if project_id:
        stmt = stmt.where(Task.project_id == project_id)
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if status:
        stmt = stmt.where(Task.status.in_(status))
    if priority:
        stmt = stmt.where(Task.priority == priority)
    if q:
        stmt = stmt.where(Task.title.ilike(f"%{q.strip()}%"))
    if blocked:
        stmt = stmt.where(
            select(Blocker.id)
            .where(Blocker.task_id == Task.id, Blocker.status == BlockerStatus.OPEN)
            .exists()
        )
    if overdue:
        stmt = stmt.where(
            Task.due_date < date.today(), Task.status.notin_(TaskStatus.closed_statuses())
        )

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Task.due_date.is_(None), Task.due_date.asc(), Task.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .unique()
        .all()
    )
    return list(rows), total


def get_task(db: Session, user: User, task_id: str) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise NotFoundError("Task not found")
    ensure_task_visible(user, task)
    return task


def create_task(db: Session, user: User, payload: TaskCreate) -> Task:
    project = get_project_or_404(db, payload.project_id)
    ensure_project_visible(user, project)
    if payload.assignee_id:
        get_user_or_404(db, payload.assignee_id)
    if payload.status == TaskStatus.DONE:
        raise DomainValidationError("Create the task before marking it done")

    task = Task(
        project_id=payload.project_id,
        title=payload.title.strip(),
        description=payload.description,
        assignee_id=payload.assignee_id,
        priority=payload.priority,
        status=payload.status,
        due_date=payload.due_date,
        is_at_risk=payload.is_at_risk,
        at_risk_reason=payload.at_risk_reason,
        created_by_id=user.id,
    )
    db.add(task)
    db.flush()

    record_event(
        db,
        event_type="task.created",
        entity_type="task",
        entity_id=task.id,
        actor=user,
        source=AuditSource.TASK_INTERFACE,
        new=snapshot(task, _TASK_FIELDS),
    )
    return task


def patch_task(
    db: Session,
    user: User,
    task_id: str,
    payload: TaskPatch,
    *,
    session_id: str | None = None,
    audit_source: AuditSource = AuditSource.TASK_INTERFACE,
) -> Task:
    task = get_task_or_404(db, task_id)
    ensure_task_editable(user, task)

    changes = payload.model_dump(exclude_unset=True)
    expected_version = changes.pop("expected_version", None)
    if expected_version is not None and expected_version != task.version:
        raise ConflictError(
            "Task changed since you loaded it. Refresh and re-apply your edit.",
            details={"current_version": task.version, "expected_version": expected_version},
        )
    if not changes:
        return task

    if "assignee_id" in changes and not is_manager(user):
        raise ForbiddenError("Only managers can reassign tasks")
    if "project_id" in changes:
        if not is_manager(user):
            raise ForbiddenError("Only managers can move tasks between projects")
        get_project_or_404(db, changes["project_id"])
    if changes.get("assignee_id"):
        get_user_or_404(db, changes["assignee_id"])

    previous = snapshot(task, _TASK_FIELDS)
    status_before = task.status

    if "status" in changes:
        changes["status"] = TaskStatus(changes["status"])
    if "priority" in changes:
        from app.enums import Priority

        changes["priority"] = Priority(changes["priority"])

    for field, value in changes.items():
        if field in ("title", "description", "at_risk_reason") and isinstance(value, str):
            value = value.strip()
            if field != "title" and not value:
                value = None
        setattr(task, field, value)

    if "status" in changes and task.status != status_before:
        if task.status == TaskStatus.DONE:
            task.completed_at = utcnow()
        elif status_before == TaskStatus.DONE:
            task.completed_at = None
        if task.status == TaskStatus.DONE and task.is_at_risk:
            task.is_at_risk = False
            task.at_risk_reason = None

    task.version += 1
    db.flush()

    new = snapshot(task, _TASK_FIELDS)
    record_event(
        db,
        event_type="task.updated",
        entity_type="task",
        entity_id=task.id,
        actor=user,
        source=audit_source,
        session_id=session_id,
        previous=previous,
        new=new,
        context={"changed_fields": sorted(changes)},
    )
    if "status" in changes:
        record_event(
            db,
            event_type="task.status_changed",
            entity_type="task",
            entity_id=task.id,
            actor=user,
            source=audit_source,
            session_id=session_id,
            previous={"status": status_before.value},
            new={"status": task.status.value},
        )
    return task


def add_task_update(
    db: Session,
    user: User,
    task: Task,
    payload: TaskUpdateCreate,
    *,
    session_id: str | None = None,
    source: UpdateSource = UpdateSource.TASK_INTERFACE,
    audit_source: AuditSource = AuditSource.TASK_INTERFACE,
) -> TaskUpdate:
    ensure_task_visible(user, task)
    if not is_manager(user) and task.assignee_id != user.id:
        raise ForbiddenError("You can only add progress updates to your own tasks")

    attributed_to = payload.attributed_to_user_id
    if attributed_to and attributed_to != user.id and not is_manager(user):
        raise ForbiddenError("Only managers can record an update on behalf of someone")

    update = TaskUpdate(
        task_id=task.id,
        author_id=user.id,
        attributed_to_user_id=attributed_to,
        session_id=session_id,
        source=source,
        progress=payload.progress.strip(),
        next_steps=payload.next_steps.strip() if payload.next_steps else None,
    )
    db.add(update)
    db.flush()
    record_event(
        db,
        event_type="task.update_added",
        entity_type="task",
        entity_id=task.id,
        actor=user,
        source=audit_source,
        session_id=session_id,
        new={
            "update_id": update.id,
            "progress": update.progress,
            "next_steps": update.next_steps,
            "attributed_to_user_id": update.attributed_to_user_id,
        },
    )
    return update


def add_update_endpoint(db: Session, user: User, task_id: str, payload: TaskUpdateCreate):
    task = get_task_or_404(db, task_id)
    update = add_task_update(db, user, task, payload)
    return task_update_out(update)


def create_blocker(
    db: Session,
    user: User,
    payload: BlockerCreate,
    *,
    session_id: str | None = None,
    audit_source: AuditSource = AuditSource.TASK_INTERFACE,
) -> Blocker:
    task: Task | None = None
    if payload.task_id:
        task = get_task_or_404(db, payload.task_id)
        ensure_task_editable(user, task)
    elif payload.project_id:
        ensure_project_visible(user, get_project_or_404(db, payload.project_id))

    if payload.owner_id:
        get_user_or_404(db, payload.owner_id)

    blocker = Blocker(
        task_id=payload.task_id,
        project_id=payload.project_id or (task.project_id if task else None),
        description=payload.description.strip(),
        owner_id=payload.owner_id,
        reported_by_id=user.id,
        reported_session_id=session_id,
        status=BlockerStatus.OPEN,
    )
    db.add(blocker)
    db.flush()
    record_event(
        db,
        event_type="blocker.created",
        entity_type="blocker",
        entity_id=blocker.id,
        actor=user,
        source=audit_source,
        session_id=session_id,
        new={
            "task_id": blocker.task_id,
            "description": blocker.description,
            "owner_id": blocker.owner_id,
        },
    )
    return blocker


def resolve_blocker(
    db: Session,
    user: User,
    blocker_id: str,
    resolution_details: str,
    *,
    session_id: str | None = None,
    audit_source: AuditSource = AuditSource.TASK_INTERFACE,
) -> Blocker:
    blocker = db.get(Blocker, blocker_id)
    if blocker is None:
        raise NotFoundError("Blocker not found")
    if blocker.status == BlockerStatus.RESOLVED:
        raise ConflictError("Blocker is already resolved")
    if blocker.task:
        ensure_task_visible(user, blocker.task)
    if not (
        is_manager(user) or blocker.owner_id == user.id or blocker.reported_by_id == user.id
    ):
        raise ForbiddenError("Only the owner, reporter or a manager can resolve this blocker")

    blocker.status = BlockerStatus.RESOLVED
    blocker.resolved_at = utcnow()
    blocker.resolved_by_id = user.id
    blocker.resolved_session_id = session_id
    blocker.resolution_details = resolution_details.strip()
    db.flush()
    record_event(
        db,
        event_type="blocker.resolved",
        entity_type="blocker",
        entity_id=blocker.id,
        actor=user,
        source=audit_source,
        session_id=session_id,
        previous={"status": BlockerStatus.OPEN.value},
        new={
            "status": BlockerStatus.RESOLVED.value,
            "resolution_details": blocker.resolution_details,
        },
    )
    return blocker


def create_action_item(
    db: Session,
    user: User,
    payload: ActionItemCreate,
    *,
    session_id: str | None = None,
    audit_source: AuditSource = AuditSource.MANAGER_ACTION,
    created_by: User | None = None,
) -> ActionItem:
    if not is_manager(user):
        raise ForbiddenError("Only managers can create action items")
    if payload.owner_id:
        get_user_or_404(db, payload.owner_id)
    if payload.task_id:
        task = get_task_or_404(db, payload.task_id)
        ensure_task_visible(user, task)

    item = ActionItem(
        session_id=session_id,
        task_id=payload.task_id,
        description=payload.description.strip(),
        owner_id=payload.owner_id,
        due_date=payload.due_date,
        status=ActionItemStatus.OPEN,
        created_by_id=(created_by or user).id,
    )
    db.add(item)
    db.flush()
    record_event(
        db,
        event_type="action_item.created",
        entity_type="action_item",
        entity_id=item.id,
        actor=user,
        source=audit_source,
        session_id=session_id,
        new={
            "description": item.description,
            "owner_id": item.owner_id,
            "task_id": item.task_id,
            "due_date": item.due_date.isoformat() if item.due_date else None,
        },
    )
    return item


def patch_action_item(
    db: Session, user: User, item_id: str, payload: ActionItemPatch
) -> ActionItem:
    item = db.get(ActionItem, item_id)
    if item is None:
        raise NotFoundError("Action item not found")
    if not (is_manager(user) or item.owner_id == user.id):
        raise ForbiddenError("Only the owner or a manager can update this action item")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return item
    previous = {
        "status": item.status.value,
        "owner_id": item.owner_id,
        "due_date": item.due_date.isoformat() if item.due_date else None,
        "description": item.description,
    }
    previous_status = item.status
    for field, value in changes.items():
        if field in ("description",) and isinstance(value, str):
            value = value.strip()
        setattr(item, field, value)
    if "status" in changes:
        if item.status == ActionItemStatus.COMPLETED:
            item.completed_at = utcnow()
            item.completed_by_id = user.id
        else:
            item.completed_at = None
            item.completed_by_id = None
    db.flush()
    record_event(
        db,
        event_type="action_item.updated",
        entity_type="action_item",
        entity_id=item.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION if is_manager(user) else AuditSource.EMPLOYEE_UPDATE,
        session_id=item.session_id,
        previous=previous,
        new={
            "status": item.status.value,
            "owner_id": item.owner_id,
            "due_date": item.due_date.isoformat() if item.due_date else None,
            "description": item.description,
        },
    )
    if previous_status != item.status and item.status == ActionItemStatus.COMPLETED:
        record_event(
            db,
            event_type="action_item.completed",
            entity_type="action_item",
            entity_id=item.id,
            actor=user,
            source=AuditSource.MANAGER_ACTION
            if is_manager(user)
            else AuditSource.EMPLOYEE_UPDATE,
            session_id=item.session_id,
            new={"completed_by_id": user.id},
        )
    return item


def create_decision(
    db: Session,
    user: User,
    payload: DecisionCreate,
    *,
    session_id: str | None = None,
    audit_source: AuditSource = AuditSource.MANAGER_ACTION,
    decided_by: User | None = None,
) -> Decision:
    if not is_manager(user):
        raise ForbiddenError("Only managers can record decisions")
    if payload.task_id:
        task = get_task_or_404(db, payload.task_id)
        ensure_task_visible(user, task)
    if payload.project_id:
        ensure_project_visible(user, get_project_or_404(db, payload.project_id))
    if payload.responsible_user_id:
        get_user_or_404(db, payload.responsible_user_id)

    decision = Decision(
        session_id=session_id,
        task_id=payload.task_id,
        project_id=payload.project_id,
        description=payload.description.strip(),
        rationale=payload.rationale.strip() if payload.rationale else None,
        decided_by_id=(decided_by or user).id,
        responsible_user_id=payload.responsible_user_id,
    )
    db.add(decision)
    db.flush()
    record_event(
        db,
        event_type="decision.recorded",
        entity_type="decision",
        entity_id=decision.id,
        actor=user,
        source=audit_source,
        session_id=session_id,
        new={
            "description": decision.description,
            "rationale": decision.rationale,
            "task_id": decision.task_id,
            "project_id": decision.project_id,
            "responsible_user_id": decision.responsible_user_id,
        },
    )
    return decision


def list_blockers(
    db: Session,
    *,
    task_id: str | None = None,
    status: BlockerStatus | None = None,
    owner_id: str | None = None,
    open_only: bool = False,
) -> list[Blocker]:
    stmt = select(Blocker).options(selectinload(Blocker.task), selectinload(Blocker.owner))
    if task_id:
        stmt = stmt.where(Blocker.task_id == task_id)
    if status:
        stmt = stmt.where(Blocker.status == status)
    if open_only:
        stmt = stmt.where(Blocker.status == BlockerStatus.OPEN)
    if owner_id:
        stmt = stmt.where(Blocker.owner_id == owner_id)
    return list(db.scalars(stmt.order_by(Blocker.created_at.asc())).all())


def list_action_items(
    db: Session,
    *,
    session_id: str | None = None,
    owner_id: str | None = None,
    status: ActionItemStatus | None = None,
    open_only: bool = False,
    task_id: str | None = None,
) -> list[ActionItem]:
    stmt = select(ActionItem).options(
        selectinload(ActionItem.task), selectinload(ActionItem.owner), selectinload(ActionItem.session)
    )
    if session_id:
        stmt = stmt.where(ActionItem.session_id == session_id)
    if task_id:
        stmt = stmt.where(ActionItem.task_id == task_id)
    if owner_id:
        stmt = stmt.where(ActionItem.owner_id == owner_id)
    if status:
        stmt = stmt.where(ActionItem.status == status)
    if open_only:
        stmt = stmt.where(ActionItem.status == ActionItemStatus.OPEN)
    return list(db.scalars(stmt.order_by(ActionItem.created_at.asc())).all())


def task_detail(db: Session, user: User, task_id: str):
    from app.schemas.tasks import TaskDetail  # local import keeps module light

    task = get_task(db, user, task_id)
    base = task_out(task)
    return TaskDetail(
        **base.model_dump(),
        updates=[task_update_out(u) for u in task.updates],
        blockers=[blocker_out(b) for b in task.blockers],
        action_items=[action_item_out(a) for a in task.action_items],
        decisions=[decision_out(d) for d in task.decisions],
    )



