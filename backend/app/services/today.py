from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.rbac import is_manager
from app.models import StandupSession, User
from app.schemas.common import Page
from app.schemas.today import TodayOut, TodaySession
from app.services.attention import build_attention, build_current_work
from app.services.daily_updates import get_today as get_daily_update


def build_today(
    db: Session,
    user: User,
    *,
    attention_limit: int = 25,
    attention_offset: int = 0,
    work_limit: int = 6,
) -> TodayOut:
    session = db.scalar(
        select(StandupSession).where(StandupSession.session_date == date.today())
    )
    session_summary = None
    if session is not None:
        visible = is_manager(user) or any(
            participant.user_id == user.id for participant in session.participants
        )
        if visible:
            session_summary = TodaySession(
                id=session.id,
                session_date=session.session_date,
                status=session.status,
                facilitator=session.facilitator,
                reviewed_count=sum(
                    1 for participant in session.participants if participant.reviewed_at
                ),
                participant_count=len(session.participants),
            )

    attention_items, attention_total = build_attention(
        db, user, limit=attention_limit, offset=attention_offset
    )
    current_work = build_current_work(db, user, limit=work_limit)

    return TodayOut(
        session=session_summary,
        daily_update=get_daily_update(db, user),
        attention=Page(
            items=attention_items,
            total=attention_total,
            limit=attention_limit,
            offset=attention_offset,
        ),
        current_work=current_work,
    )
