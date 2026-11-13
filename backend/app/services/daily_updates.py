from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import AuditSource
from app.models import DailyUpdate, User, utcnow
from app.schemas.today import DailyUpdateIn, DailyUpdateOut
from app.services.audit import record_event


def get_today(db: Session, user: User) -> DailyUpdateOut | None:
    row = db.scalar(
        select(DailyUpdate).where(
            DailyUpdate.user_id == user.id,
            DailyUpdate.update_date == date.today(),
        )
    )
    return DailyUpdateOut.model_validate(row) if row else None


def upsert_today(db: Session, user: User, payload: DailyUpdateIn) -> DailyUpdateOut:
    """One optional short update per employee per day; safe to retry."""
    today = date.today()
    row = db.scalar(
        select(DailyUpdate).where(
            DailyUpdate.user_id == user.id,
            DailyUpdate.update_date == today,
        )
    )
    progress = payload.progress.strip()
    next_steps = payload.next_steps.strip() if payload.next_steps else None

    if row is None:
        row = DailyUpdate(
            user_id=user.id,
            update_date=today,
            progress=progress,
            next_steps=next_steps,
        )
        db.add(row)
        db.flush()
        record_event(
            db,
            event_type="daily_update.created",
            entity_type="daily_update",
            entity_id=row.id,
            actor=user,
            source=AuditSource.EMPLOYEE_UPDATE,
            new={"progress": progress, "next_steps": next_steps},
        )
    else:
        previous = {"progress": row.progress, "next_steps": row.next_steps}
        row.progress = progress
        row.next_steps = next_steps
        row.updated_at = utcnow()
        db.flush()
        record_event(
            db,
            event_type="daily_update.updated",
            entity_type="daily_update",
            entity_id=row.id,
            actor=user,
            source=AuditSource.EMPLOYEE_UPDATE,
            previous=previous,
            new={"progress": progress, "next_steps": next_steps},
        )
    return DailyUpdateOut.model_validate(row)


def get_for_user_date(db: Session, user_id: str, day: date) -> DailyUpdate | None:
    return db.scalar(
        select(DailyUpdate).where(
            DailyUpdate.user_id == user_id, DailyUpdate.update_date == day
        )
    )
