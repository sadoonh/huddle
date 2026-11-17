from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DB, CurrentUser
from app.schemas.standups import (
    CompleteSessionRequest,
    MeetingActionItemCreate,
    MeetingBlockerCreate,
    MeetingDecisionCreate,
    ParticipantPatch,
    ParticipantWorkspace,
    PreMeetingSubmit,
    ProgressCapture,
    SessionCreate,
    SessionDetail,
    SessionNoteCreate,
    SessionNoteOut,
    SessionSummaryOut,
)
from app.schemas.tasks import (
    ActionItemOut,
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


@router.post("/sessions", response_model=SessionDetail, status_code=201)
def create_session(db: DB, user: CurrentUser, payload: SessionCreate):
    return standup_service.create_session(db, user, payload)


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def session(db: DB, user: CurrentUser, session_id: str):
    return standup_service.session_detail(db, user, session_id)


@router.post("/sessions/{session_id}/start", response_model=SessionDetail)
def start(db: DB, user: CurrentUser, session_id: str):
    return standup_service.start_session(db, user, session_id)


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
    return standup_service.capture_note(
        db, user, session_id, payload.body, payload.client_operation_id
    )


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
