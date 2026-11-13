from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DB, CurrentUser, Pagination
from app.enums import IntakeStatus
from app.schemas.common import Page
from app.schemas.intake import (
    IntakeConvertProject,
    IntakeConvertTask,
    IntakeCreate,
    IntakeOut,
    IntakePatch,
)
from app.services import intake as intake_service

router = APIRouter(prefix="/intake", tags=["intake"])


@router.get("", response_model=Page[IntakeOut])
def list_requests(
    db: DB,
    user: CurrentUser,
    pagination: Pagination,
    status: IntakeStatus | None = None,
):
    items, total = intake_service.list_requests(
        db, user, status=status, limit=pagination.limit, offset=pagination.offset
    )
    return Page[IntakeOut](
        items=items, total=total, limit=pagination.limit, offset=pagination.offset
    )


@router.post("", response_model=IntakeOut, status_code=201)
def create_request(db: DB, user: CurrentUser, payload: IntakeCreate):
    return intake_service.create_request(db, user, payload)


@router.get("/{request_id}", response_model=IntakeOut)
def get_request(db: DB, user: CurrentUser, request_id: str):
    return IntakeOut.model_validate(intake_service.get_request(db, user, request_id))


@router.patch("/{request_id}", response_model=IntakeOut)
def patch_request(db: DB, user: CurrentUser, request_id: str, payload: IntakePatch):
    return intake_service.patch_request(db, user, request_id, payload)


@router.post("/{request_id}/convert-to-task", response_model=IntakeOut)
def convert_to_task(db: DB, user: CurrentUser, request_id: str, payload: IntakeConvertTask):
    return intake_service.convert_to_task(db, user, request_id, payload)


@router.post("/{request_id}/convert-to-project", response_model=IntakeOut)
def convert_to_project(
    db: DB, user: CurrentUser, request_id: str, payload: IntakeConvertProject
):
    return intake_service.convert_to_project(db, user, request_id, payload)
