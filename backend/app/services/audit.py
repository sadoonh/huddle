"""Append-only audit trail.

Every mutation service calls :func:`record_event` *before* its transaction
commits. Because the request-level dependency commits once, a mutation and its
audit row are atomic by construction.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.enums import ActorType, AuditSource
from app.models import AuditEvent, User


def record_event(
    db: Session,
    *,
    event_type: str,
    entity_type: str,
    entity_id: str,
    actor: User | None,
    source: AuditSource,
    actor_type: ActorType | str = ActorType.USER,
    actor_label: str | None = None,
    session_id: str | None = None,
    previous: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor.id if actor else None,
        actor_type=ActorType(actor_type),
        actor_label=actor_label or (actor.full_name if actor else "system"),
        source=AuditSource(source),
        session_id=session_id,
        previous_values=previous,
        new_values=new,
        context=context,
    )
    db.add(event)
    return event


def snapshot(entity: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    """Build an audit ``previous``/``new`` payload from selected ORM fields."""
    result: dict[str, Any] = {}
    for field in fields:
        value = getattr(entity, field, None)
        if hasattr(value, "value"):  # enum
            value = value.value
        elif hasattr(value, "isoformat"):  # date/datetime
            value = value.isoformat()
        result[field] = value
    return result
