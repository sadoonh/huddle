from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ConflictError, NotFoundError
from app.core.rbac import get_project_or_404, is_manager, require_manager
from app.enums import AuditSource, IntakeStatus
from app.models import IntakeRequest, User
from app.schemas.intake import (
    IntakeConvertProject,
    IntakeConvertTask,
    IntakeCreate,
    IntakeOut,
    IntakePatch,
)
from app.schemas.projects import ProjectCreate
from app.schemas.tasks import TaskCreate
from app.services.audit import record_event, snapshot
from app.services.projects import create_project
from app.services.tasks import create_task

_FIELDS = ("title", "description", "priority", "status", "review_note")


def _base_query():
    return select(IntakeRequest).options(
        selectinload(IntakeRequest.requester),
        selectinload(IntakeRequest.reviewed_by),
    )


def create_request(db: Session, user: User, payload: IntakeCreate) -> IntakeOut:
    request = IntakeRequest(
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        requester_id=user.id,
        requester_name=payload.requester_name or user.full_name,
        priority=payload.priority,
        status=IntakeStatus.NEW,
    )
    db.add(request)
    db.flush()
    record_event(
        db,
        event_type="intake.created",
        entity_type="intake_request",
        entity_id=request.id,
        actor=user,
        source=AuditSource.EMPLOYEE_UPDATE,
        new=snapshot(request, _FIELDS),
    )
    return IntakeOut.model_validate(request)


def list_requests(
    db: Session,
    user: User,
    *,
    status: IntakeStatus | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[IntakeOut], int]:
    stmt = _base_query()
    if not is_manager(user):
        stmt = stmt.where(IntakeRequest.requester_id == user.id)
    if status:
        stmt = stmt.where(IntakeRequest.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.scalars(
        stmt.order_by(IntakeRequest.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return [IntakeOut.model_validate(r) for r in rows], total


def get_request(db: Session, user: User, request_id: str) -> IntakeRequest:
    request = db.get(IntakeRequest, request_id)
    if request is None:
        raise NotFoundError("Intake request not found")
    if not is_manager(user) and request.requester_id != user.id:
        from app.core.errors import ForbiddenError

        raise ForbiddenError("You do not have access to this intake request")
    return request


def patch_request(
    db: Session, user: User, request_id: str, payload: IntakePatch
) -> IntakeOut:
    require_manager(user)
    request = get_request(db, user, request_id)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return IntakeOut.model_validate(request)

    previous = snapshot(request, _FIELDS)
    for field, value in changes.items():
        if field in ("title", "description", "review_note") and isinstance(value, str):
            value = value.strip()
        setattr(request, field, value)
    if "status" in changes and request.status in (
        IntakeStatus.ACCEPTED,
        IntakeStatus.REJECTED,
        IntakeStatus.UNDER_REVIEW,
    ):
        request.reviewed_by_id = user.id
    db.flush()
    record_event(
        db,
        event_type="intake.reviewed",
        entity_type="intake_request",
        entity_id=request.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        previous=previous,
        new=snapshot(request, _FIELDS),
    )
    return IntakeOut.model_validate(request)


def convert_to_task(
    db: Session, user: User, request_id: str, payload: IntakeConvertTask
) -> IntakeOut:
    require_manager(user)
    request = get_request(db, user, request_id)
    if request.status == IntakeStatus.CONVERTED:
        raise ConflictError("Request was already converted")
    get_project_or_404(db, payload.project_id)

    task = create_task(
        db,
        user,
        TaskCreate(
            project_id=payload.project_id,
            title=payload.title or request.title,
            description=payload.description or request.description,
            assignee_id=payload.assignee_id,
            priority=payload.priority or request.priority,
            due_date=payload.due_date,
        ),
    )
    request.status = IntakeStatus.CONVERTED
    request.reviewed_by_id = user.id
    request.converted_task_id = task.id
    db.flush()
    record_event(
        db,
        event_type="intake.converted",
        entity_type="intake_request",
        entity_id=request.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        new={"converted_task_id": task.id},
    )
    return IntakeOut.model_validate(request)


def convert_to_project(
    db: Session, user: User, request_id: str, payload: IntakeConvertProject
) -> IntakeOut:
    require_manager(user)
    request = get_request(db, user, request_id)
    if request.status == IntakeStatus.CONVERTED:
        raise ConflictError("Request was already converted")

    project = create_project(
        db,
        user,
        ProjectCreate(
            name=payload.name or request.title,
            description=payload.description or request.description,
            owner_id=user.id,
            member_ids=payload.member_ids,
        ),
    )
    request.status = IntakeStatus.CONVERTED
    request.reviewed_by_id = user.id
    request.converted_project_id = project.id
    db.flush()
    record_event(
        db,
        event_type="intake.converted",
        entity_type="intake_request",
        entity_id=request.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        new={"converted_project_id": project.id},
    )
    return IntakeOut.model_validate(request)
