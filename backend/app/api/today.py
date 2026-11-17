from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import DB, CurrentUser
from app.schemas.today import TodayOut
from app.services.today import build_today

router = APIRouter(tags=["today"])


@router.get("/today", response_model=TodayOut)
def today(
    db: DB,
    user: CurrentUser,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = None,
    assignee_id: str | None = None,
    recent_limit: int = Query(default=10, ge=1, le=25),
):
    return build_today(
        db,
        user,
        limit=limit,
        offset=offset,
        q=q,
        assignee_id=assignee_id,
        recent_limit=recent_limit,
    )
