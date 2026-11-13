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
    attention_limit: int = Query(default=25, ge=1, le=100),
    attention_offset: int = Query(default=0, ge=0),
    work_limit: int = Query(default=6, ge=1, le=20),
):
    return build_today(
        db,
        user,
        attention_limit=attention_limit,
        attention_offset=attention_offset,
        work_limit=work_limit,
    )
