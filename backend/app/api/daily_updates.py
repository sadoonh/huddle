from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DB, CurrentUser
from app.schemas.today import DailyUpdateIn, DailyUpdateOut
from app.services import daily_updates as daily_service

router = APIRouter(prefix="/daily-updates", tags=["daily-updates"])


@router.get("/today", response_model=DailyUpdateOut | None)
def get_today(db: DB, user: CurrentUser):
    return daily_service.get_today(db, user)


@router.put("/today", response_model=DailyUpdateOut)
def put_today(db: DB, user: CurrentUser, payload: DailyUpdateIn):
    return daily_service.upsert_today(db, user, payload)
