from __future__ import annotations

from datetime import date

from fastapi import APIRouter

router = APIRouter(tags=["meta"])


@router.get("/meta")
def meta():
    """Server business date; the team day boundary is the server's UTC date."""
    return {"business_date": date.today().isoformat(), "timezone": "UTC"}
