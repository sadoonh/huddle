from __future__ import annotations

from datetime import date

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, Pagination
from app.models import SessionNote
from app.schemas.common import Page
from app.schemas.standups import (
    CarryForwardOut,
    CompleteSessionRequest,
    MeetingActionItemCreate,
    MeetingBlockerCreate,
    MeetingDecisionCreate,
    ParticipantPatch,
    ParticipantWorkspace,
    PreMeetingSubmit,
    ProgressCapture,
    SessionCaptures,
    SessionCreate,
    SessionDetail,
    SessionNoteCreate,
    SessionNoteOut,
    SessionOut,
    SessionOutcomes,
    SessionSummaryOut,
    UserStandupHistory,
)
from app.schemas.tasks import (
    ActionItemOut,
    AuditEventOut,
    BlockerOut,
    BlockerResolve,
    DecisionOut,
    TaskOut,
    TaskStatusChange,
    TaskUpdateOut,
)
from app.services import standups as standup_service

router = APIRouter(prefix="/standups", tags=["standups"])


@router.get("/today", response_model=SessionDetail | None)
def today(db: DB, user: CurrentUser):
    return standup_service.get_today(db, user)


@router.get("/sessions", response_model=Page[SessionOut])
def sessions(db: DB, user: CurrentUser, pagination: Pagination, status: str | None = None):
    from app.enums import SessionStatus

    parsed = SessionStatus(status) if status else None
    items, total = standup_service.list_sessions(
        db, user, status=parsed, limit=pagination.limit, offset=pagination.offset
    )
    return Page[SessionOut](
        items=items, total=total, limit=pagination.limit, offset=pagination.offset
    )


@router.post("/sessions", response_model=SessionDetail, status_code=201)
def create_session(db: DB, user: CurrentUser, payload: SessionCreate):
    return standup_service.create_session(db, user, payload)


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def session(db: DB, user: CurrentUser, session_id: str):
    return standup_service.session_detail(db, user, session_id)


@router.post("/sessions/{session_id}/start", response_model=SessionDetail)
def start(db: DB, user: CurrentUser, session_id: str):
    return standup_service.start_session(db, user, session_id)


@router.get("/sessions/{session_id}/captures", response_model=SessionCaptures)
def captures(db: DB, user: CurrentUser, session_id: str):
    return standup_service.session_captures(db, user, session_id)


@router.get("/sessions/{session_id}/summary", response_model=SessionSummaryOut)
def summary(db: DB, user: CurrentUser, session_id: str):
    return standup_service.summary(db, user, session_id)


@router.post("/sessions/{session_id}/complete", response_model=SessionSummaryOut)
def complete(db: DB, user: CurrentUser, session_id: str, payload: CompleteSessionRequest):
    return standup_service.complete_session(
        db, user, session_id, notes=payload.notes, force=payload.force
    )


# ---------------------------------------------------------------------------
# Pre-meeting and participants
# ---------------------------------------------------------------------------
@router.post(
    "/sessions/{session_id}/participants/{user_id}/pre-meeting",
    response_model=ParticipantWorkspace,
)
def submit_pre_meeting(
    db: DB,
    user: CurrentUser,
    session_id: str,
    user_id: str,
    payload: PreMeetingSubmit,
):
    return standup_service.submit_pre_meeting(db, user, session_id, user_id, payload)


@router.get(
    "/sessions/{session_id}/participants/{user_id}/workspace",
    response_model=ParticipantWorkspace,
)
def workspace(db: DB, user: CurrentUser, session_id: str, user_id: str):
    return standup_service.build_workspace(db, user, session_id, user_id)


@router.patch(
    "/sessions/{session_id}/participants/{user_id}",
    response_model=ParticipantWorkspace,
)
def patch_participant(
    db: DB, user: CurrentUser, session_id: str, user_id: str, payload: ParticipantPatch
):
    return standup_service.patch_participant(db, user, session_id, user_id, payload)


# ---------------------------------------------------------------------------
# In-meeting capture
# ---------------------------------------------------------------------------
@router.post("/sessions/{session_id}/updates", response_model=TaskUpdateOut, status_code=201)
def capture_progress(db: DB, user: CurrentUser, session_id: str, payload: ProgressCapture):
    return standup_service.capture_progress(db, user, session_id, payload)


@router.post("/sessions/{session_id}/blockers", response_model=BlockerOut, status_code=201)
def capture_blocker(
    db: DB, user: CurrentUser, session_id: str, payload: MeetingBlockerCreate
):
    return standup_service.capture_blocker(db, user, session_id, payload)


@router.patch(
    "/sessions/{session_id}/blockers/{blocker_id}/resolve", response_model=BlockerOut
)
def resolve_blocker(
    db: DB,
    user: CurrentUser,
    session_id: str,
    blocker_id: str,
    payload: BlockerResolve,
):
    return standup_service.resolve_blocker_in_session(
        db, user, session_id, blocker_id, payload.resolution_details
    )


@router.post(
    "/sessions/{session_id}/action-items", response_model=ActionItemOut, status_code=201
)
def capture_action_item(
    db: DB, user: CurrentUser, session_id: str, payload: MeetingActionItemCreate
):
    return standup_service.capture_action_item(db, user, session_id, payload)


@router.post(
    "/sessions/{session_id}/decisions", response_model=DecisionOut, status_code=201
)
def capture_decision(
    db: DB, user: CurrentUser, session_id: str, payload: MeetingDecisionCreate
):
    return standup_service.capture_decision(db, user, session_id, payload)


@router.post("/sessions/{session_id}/notes", response_model=SessionNoteOut, status_code=201)
def capture_note(db: DB, user: CurrentUser, session_id: str, payload: SessionNoteCreate):
    return standup_service.capture_note(db, user, session_id, payload.body)


@router.get("/sessions/{session_id}/notes", response_model=list[SessionNoteOut])
def list_notes(db: DB, user: CurrentUser, session_id: str):
    from app.core.rbac import ensure_session_visible

    session = standup_service.get_session_or_404(db, session_id)
    ensure_session_visible(user, session)
    notes = db.scalars(
        select(SessionNote)
        .where(SessionNote.session_id == session_id)
        .order_by(SessionNote.created_at.asc())
    ).all()
    return [SessionNoteOut.model_validate(n) for n in notes]


@router.patch("/sessions/{session_id}/tasks/{task_id}/status", response_model=TaskOut)
def capture_task_status(
    db: DB,
    user: CurrentUser,
    session_id: str,
    task_id: str,
    payload: TaskStatusChange,
):
    return standup_service.capture_task_status(
        db, user, session_id, task_id, payload.status
    )


# ---------------------------------------------------------------------------
# History / carry-forward
# ---------------------------------------------------------------------------
@router.get("/sessions/{session_id}/outcomes", response_model=SessionOutcomes)
def outcomes(db: DB, user: CurrentUser, session_id: str):
    return standup_service.session_outcomes(db, user, session_id)


@router.get("/sessions/{session_id}/timeline", response_model=list[AuditEventOut])
def timeline(db: DB, user: CurrentUser, session_id: str):
    return standup_service.session_timeline(db, user, session_id)


@router.get("/users/{user_id}/history", response_model=UserStandupHistory)
def history(
    db: DB,
    user: CurrentUser,
    user_id: str,
    start: date | None = None,
    end: date | None = None,
    limit: int = 30,
):
    return standup_service.user_history(
        db, user, user_id, start=start, end=end, limit=limit
    )


@router.get("/users/{user_id}/carry-forward", response_model=CarryForwardOut)
def carry_forward(db: DB, user: CurrentUser, user_id: str):
    return standup_service.carry_forward(db, user, user_id)
