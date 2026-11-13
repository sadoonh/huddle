from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from app.api.deps import DB, CurrentUser
from app.config import get_settings
from app.enums import ProposalStatus
from app.schemas.tasks import (
    ProposalEdit,
    ProposalOut,
    ReviewAction,
    TranscriptDetail,
    TranscriptOut,
)
from app.services import ai as ai_service

router = APIRouter(prefix="/ai", tags=["ai-reconciliation"])
settings = get_settings()


@router.post("/transcripts", response_model=TranscriptDetail, status_code=201)
def upload_transcript(
    db: DB,
    user: CurrentUser,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    session_id: str | None = Form(default=None),
):
    data = file.file.read()
    detail = ai_service.create_transcript(
        db,
        user,
        filename=file.filename or "transcript.txt",
        content_type=file.content_type,
        data=data,
        session_id=session_id,
    )
    if detail.status == "uploaded" and not settings.ai_processing_inline:
        background.add_task(ai_service.process_transcript_job, detail.id)
    return detail


@router.get("/transcripts", response_model=list[TranscriptOut])
def list_transcripts(db: DB, user: CurrentUser):
    return ai_service.list_transcripts(db, user)


@router.get("/transcripts/{transcript_id}", response_model=TranscriptDetail)
def get_transcript(db: DB, user: CurrentUser, transcript_id: str):
    return ai_service.transcript_detail(db, user, transcript_id)


@router.post("/transcripts/{transcript_id}/reprocess", response_model=TranscriptDetail)
def reprocess(db: DB, user: CurrentUser, transcript_id: str):
    return ai_service.reprocess_transcript(db, user, transcript_id)


@router.get("/proposals", response_model=list[ProposalOut])
def list_proposals(
    db: DB,
    user: CurrentUser,
    status: ProposalStatus | None = None,
    transcript_id: str | None = None,
    session_id: str | None = None,
):
    return ai_service.list_proposals(
        db, user, status=status, transcript_id=transcript_id, session_id=session_id
    )


@router.get("/proposals/{proposal_id}", response_model=ProposalOut)
def get_proposal(db: DB, user: CurrentUser, proposal_id: str):
    from app.core.serializers import proposal_out

    return proposal_out(ai_service.get_proposal(db, user, proposal_id))


@router.patch("/proposals/{proposal_id}", response_model=ProposalOut)
def edit_proposal(db: DB, user: CurrentUser, proposal_id: str, payload: ProposalEdit):
    return ai_service.edit_proposal(db, user, proposal_id, payload.payload, payload.review_note)


@router.post("/proposals/{proposal_id}/approve", response_model=ProposalOut)
def approve(db: DB, user: CurrentUser, proposal_id: str, payload: ReviewAction):
    return ai_service.approve_proposal(db, user, proposal_id, payload.note)


@router.post("/proposals/{proposal_id}/reject", response_model=ProposalOut)
def reject(db: DB, user: CurrentUser, proposal_id: str, payload: ReviewAction):
    return ai_service.reject_proposal(db, user, proposal_id, payload.note)


@router.post("/proposals/{proposal_id}/apply", response_model=ProposalOut)
def apply(db: DB, user: CurrentUser, proposal_id: str):
    return ai_service.apply_proposal(db, user, proposal_id)
