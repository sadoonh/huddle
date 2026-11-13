from __future__ import annotations

from datetime import date

from fastapi import APIRouter
from sqlalchemy import and_, or_, select

from app.api.deps import DB, CurrentUser, Pagination
from app.core.rbac import is_manager
from app.core.serializers import audit_out
from app.enums import AuditSource
from app.models import AuditEvent, StandupParticipant, Task
from app.schemas.common import Page
from app.schemas.tasks import AuditEventOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=Page[AuditEventOut])
def list_audit(
    db: DB,
    user: CurrentUser,
    pagination: Pagination,
    entity_type: str | None = None,
    entity_id: str | None = None,
    session_id: str | None = None,
    event_type: str | None = None,
    source: AuditSource | None = None,
    start: date | None = None,
    end: date | None = None,
):
    from sqlalchemy import func

    stmt = select(AuditEvent)
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == entity_id)
    if session_id:
        stmt = stmt.where(AuditEvent.session_id == session_id)
    if event_type:
        stmt = stmt.where(AuditEvent.event_type == event_type)
    if source:
        stmt = stmt.where(AuditEvent.source == source)
    if start:
        stmt = stmt.where(AuditEvent.occurred_at >= start)
    if end:
        stmt = stmt.where(AuditEvent.occurred_at < end)
    if not is_manager(user):
        visible_task_ids = select(Task.id).where(
            or_(Task.assignee_id == user.id, Task.created_by_id == user.id)
        )
        participant_sessions = select(StandupParticipant.session_id).where(
            StandupParticipant.user_id == user.id
        )
        stmt = stmt.where(
            or_(
                AuditEvent.actor_id == user.id,
                AuditEvent.session_id.in_(participant_sessions),
                and_(
                    AuditEvent.entity_type == "task",
                    AuditEvent.entity_id.in_(visible_task_ids),
                ),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditEvent.occurred_at.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
    ).all()
    return Page[AuditEventOut](
        items=[audit_out(e) for e in rows],
        total=total,
        limit=pagination.limit,
        offset=pagination.offset,
    )
