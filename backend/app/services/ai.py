"""AI transcript reconciliation.

Pipeline: upload -> extraction -> (duplicate detection + task matching) ->
pending proposals -> manager review (edit / approve / reject) -> apply with
conflict protection -> audit.

Nothing here mutates a task without an explicit manager approval, and every
apply re-checks ``Task.version`` against the version captured when the proposal
was generated.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ai.extractor import ExtractedProposal, get_extractor, similarity
from app.config import get_settings
from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.rbac import ensure_session_visible, get_task_or_404, get_user_or_404, require_manager
from app.core.serializers import proposal_out, transcript_out
from app.db import SessionLocal
from app.enums import (
    AuditSource,
    BlockerStatus,
    ProposalStatus,
    TargetType,
    TaskStatus,
    TranscriptStatus,
    UpdateSource,
)
from app.models import (
    ActionItem,
    AiProposal,
    Blocker,
    Decision,
    StandupSession,
    Task,
    TaskUpdate,
    Transcript,
    User,
    utcnow,
)
from app.schemas.tasks import (
    ActionItemCreate,
    BlockerCreate,
    DecisionCreate,
    ProposalOut,
    TaskPatch,
    TaskUpdateCreate,
    TranscriptDetail,
    TranscriptOut,
)
from app.services.audit import record_event
from app.services.tasks import (
    add_task_update,
    create_action_item,
    create_blocker,
    create_decision,
    patch_task,
    resolve_blocker,
)

settings = get_settings()

_DUPLICATE_THRESHOLD = 0.55


# ---------------------------------------------------------------------------
# Upload / storage
# ---------------------------------------------------------------------------
def _safe_name(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._") or "transcript.txt"
    return cleaned[:200]


def _store_bytes(filename: str, data: bytes) -> str:
    key = f"transcripts/{uuid.uuid4()}-{_safe_name(filename)}"
    if settings.transcript_bucket:
        import boto3

        boto3.client("s3", region_name=settings.bedrock_region).put_object(
            Bucket=settings.transcript_bucket,
            Key=key,
            Body=data,
            ContentType="text/plain",
        )
        return f"s3://{settings.transcript_bucket}/{key}"
    path = Path(settings.transcript_local_dir)
    path.mkdir(parents=True, exist_ok=True)
    target = path / key.split("/")[-1]
    target.write_bytes(data)
    return str(target)


def create_transcript(
    db: Session,
    user: User,
    *,
    filename: str,
    content_type: str | None,
    data: bytes,
    session_id: str | None = None,
) -> TranscriptDetail:
    require_manager(user)
    if len(data) > settings.max_transcript_bytes:
        raise DomainValidationError(
            f"Transcript exceeds the {settings.max_transcript_bytes // (1024 * 1024)} MB limit"
        )
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DomainValidationError("Transcript must be UTF-8 encoded text") from exc
    if not text.strip():
        raise DomainValidationError("Transcript is empty")

    session = None
    if session_id:
        session = db.get(StandupSession, session_id)
        if session is None:
            raise NotFoundError("Standup session not found")
        ensure_session_visible(user, session)

    storage_key = _store_bytes(filename, data)
    transcript = Transcript(
        session_id=session.id if session else None,
        filename=_safe_name(filename),
        content_type=content_type,
        storage_key=storage_key,
        content_text=text,
        size_bytes=len(data),
        uploaded_by_id=user.id,
        status=TranscriptStatus.UPLOADED,
    )
    db.add(transcript)
    db.flush()
    record_event(
        db,
        event_type="transcript.uploaded",
        entity_type="transcript",
        entity_id=transcript.id,
        actor=user,
        source=AuditSource.AI_APPROVED,
        session_id=session.id if session else None,
        new={"filename": transcript.filename, "size_bytes": transcript.size_bytes},
    )

    if settings.ai_processing_inline:
        process_transcript(db, transcript, user)
    elif settings.sqs_queue_url:
        _enqueue_transcript(transcript.id)

    return transcript_detail(db, user, transcript.id)


def _enqueue_transcript(transcript_id: str) -> None:
    """Hand the transcript to the async worker. The DB row is the source of truth."""
    import boto3

    boto3.client("sqs", region_name=settings.bedrock_region).send_message(
        QueueUrl=settings.sqs_queue_url,
        MessageBody=json.dumps({"transcript_id": transcript_id}),
    )


def process_transcript_job(transcript_id: str) -> None:
    """Entry point for an asynchronous worker (Lambda/SQS in production)."""
    db = SessionLocal()
    try:
        transcript = db.get(Transcript, transcript_id)
        if transcript is None:
            return
        actor = transcript.uploaded_by or db.scalar(select(User).where(User.role == "manager"))
        process_transcript(db, transcript, actor)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def process_transcript(db: Session, transcript: Transcript, actor: User | None) -> Transcript:
    if transcript.status == TranscriptStatus.PROCESSING:
        raise ConflictError("Transcript is already being processed")
    if not transcript.content_text:
        raise DomainValidationError("Transcript has no text content")

    transcript.status = TranscriptStatus.PROCESSING
    transcript.error = None
    db.flush()

    session = db.get(StandupSession, transcript.session_id) if transcript.session_id else None
    try:
        context = _build_context(db, session)
        result = get_extractor().extract(transcript.content_text, context)

        for extracted in result.proposals:
            _create_proposal(db, transcript, session, extracted)

        transcript.status = TranscriptStatus.PROCESSED
        transcript.processed_at = utcnow()
        db.flush()
        record_event(
            db,
            event_type="transcript.processed",
            entity_type="transcript",
            entity_id=transcript.id,
            actor=actor,
            source=AuditSource.SYSTEM,
            session_id=session.id if session else None,
            new={"proposal_count": len(result.proposals), "model": result.model},
        )
    except Exception as exc:  # keep the failure visible instead of dropping the job
        transcript.status = TranscriptStatus.FAILED
        transcript.error = str(exc)[:2000]
        db.flush()
        record_event(
            db,
            event_type="transcript.failed",
            entity_type="transcript",
            entity_id=transcript.id,
            actor=actor,
            source=AuditSource.SYSTEM,
            session_id=session.id if session else None,
            new={"error": transcript.error},
        )
    return transcript


def reprocess_transcript(db: Session, user: User, transcript_id: str) -> TranscriptDetail:
    require_manager(user)
    transcript = db.get(Transcript, transcript_id)
    if transcript is None:
        raise NotFoundError("Transcript not found")

    pending = db.scalars(
        select(AiProposal).where(
            AiProposal.transcript_id == transcript.id,
            AiProposal.status == ProposalStatus.PENDING,
        )
    ).all()
    for proposal in pending:
        proposal.status = ProposalStatus.REJECTED
        proposal.reviewed_by_id = user.id
        proposal.reviewed_at = utcnow()
        proposal.review_note = "Superseded by reprocessing"
    db.flush()

    transcript.status = TranscriptStatus.UPLOADED
    transcript.error = None
    process_transcript(db, transcript, user)
    return transcript_detail(db, user, transcript.id)


def _build_context(db: Session, session: StandupSession | None) -> dict:
    tasks: list[Task]
    if session:
        participant_ids = [p.user_id for p in session.participants]
        tasks = list(
            db.scalars(
                select(Task)
                .options(selectinload(Task.assignee))
                .where(
                    Task.assignee_id.in_(participant_ids),
                    Task.status.notin_(TaskStatus.closed_statuses()),
                )
                .order_by(Task.updated_at.desc())
                .limit(200)
            ).all()
        )
    else:
        tasks = list(
            db.scalars(
                select(Task)
                .options(selectinload(Task.assignee))
                .where(Task.status.notin_(TaskStatus.closed_statuses()))
                .order_by(Task.updated_at.desc())
                .limit(200)
            ).all()
        )
    participants = (
        [{"id": p.user_id, "name": p.user.full_name} for p in session.participants]
        if session
        else [
            {"id": u.id, "name": u.full_name}
            for u in db.scalars(select(User).where(User.is_active.is_(True))).all()
        ]
    )
    task_ids = [t.id for t in tasks]
    blockers = list(
        db.scalars(
            select(Blocker).where(
                Blocker.status == BlockerStatus.OPEN, Blocker.task_id.in_(task_ids)
            )
        ).all()
    ) if task_ids else []
    existing: list[dict] = []
    if session:
        existing += [
            {"type": "progress_update", "task_id": u.task_id, "text": u.progress}
            for u in db.scalars(
                select(TaskUpdate).where(TaskUpdate.session_id == session.id)
            ).all()
        ]
        existing += [
            {"type": "blocker", "task_id": b.task_id, "text": b.description}
            for b in db.scalars(
                select(Blocker).where(Blocker.reported_session_id == session.id)
            ).all()
        ]
        existing += [
            {"type": "action_item", "text": a.description}
            for a in db.scalars(
                select(ActionItem).where(ActionItem.session_id == session.id)
            ).all()
        ]
        existing += [
            {"type": "decision", "text": d.description}
            for d in db.scalars(
                select(Decision).where(Decision.session_id == session.id)
            ).all()
        ]

    return {
        "session_date": session.session_date.isoformat() if session else date.today().isoformat(),
        "participants": participants,
        "tasks": [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status.value,
                "project": t.project.name if t.project else None,
                "assignee": t.assignee.full_name if t.assignee else None,
                "due_date": t.due_date.isoformat() if t.due_date else None,
            }
            for t in tasks
        ],
        "blockers": [
            {
                "id": b.id,
                "task_id": b.task_id,
                "description": b.description,
                "owner": b.owner.full_name if b.owner else None,
            }
            for b in blockers
        ],
        "existing_session_records": existing,
    }


def _create_proposal(
    db: Session,
    transcript: Transcript,
    session: StandupSession | None,
    extracted: ExtractedProposal,
) -> AiProposal:
    target_type = extracted.target_type
    target_id = extracted.target_id
    ambiguous = extracted.is_ambiguous

    task = None
    blocker = None
    if target_type == TargetType.TASK and target_id:
        task = db.get(Task, target_id)
        if task is None:
            target_id, ambiguous = None, True
    elif target_type == TargetType.BLOCKER and target_id:
        blocker = db.get(Blocker, target_id)
        if blocker is None:
            target_id, ambiguous = None, True
    elif target_type == TargetType.SESSION:
        target_id = session.id if session else None
        if target_id is None:
            ambiguous = True

    duplicate_of_type = None
    duplicate_of_id = None
    if session:
        duplicate = _detect_duplicate(
            db, session.id, extracted.operation, task, blocker, extracted.payload
        )
        if duplicate:
            duplicate_of_type, duplicate_of_id = duplicate

    current_values = None
    base_task_version = None
    if task:
        current_values = {
            "status": task.status.value,
            "assignee_id": task.assignee_id,
            "title": task.title,
        }
        base_task_version = task.version
    elif blocker:
        current_values = {"status": blocker.status.value}

    proposal = AiProposal(
        transcript_id=transcript.id,
        session_id=session.id if session else None,
        operation=extracted.operation,
        target_type=target_type,
        target_id=target_id,
        payload=extracted.payload,
        current_values=current_values,
        evidence_excerpt=extracted.evidence_excerpt,
        speaker=extracted.speaker,
        spoken_at=extracted.spoken_at,
        confidence=extracted.confidence,
        is_ambiguous=ambiguous,
        duplicate_of_type=duplicate_of_type,
        duplicate_of_id=duplicate_of_id,
        status=ProposalStatus.PENDING,
        base_task_version=base_task_version,
    )
    db.add(proposal)
    db.flush()
    record_event(
        db,
        event_type="ai_proposal.generated",
        entity_type="ai_proposal",
        entity_id=proposal.id,
        actor=None,
        actor_type="system",
        actor_label="transcript-reconciler",
        source=AuditSource.SYSTEM,
        session_id=session.id if session else None,
        new={
            "operation": proposal.operation.value,
            "target_type": target_type.value,
            "target_id": target_id,
            "ambiguous": ambiguous,
            "duplicate_of_id": duplicate_of_id,
        },
    )
    return proposal


def _detect_duplicate(
    db: Session,
    session_id: str,
    operation,
    task: Task | None,
    blocker: Blocker | None,
    payload: dict,
) -> tuple[str, str] | None:
    if operation.value == "add_progress_update" and task:
        text = payload.get("progress", "")
        rows = db.scalars(
            select(TaskUpdate).where(
                TaskUpdate.session_id == session_id, TaskUpdate.task_id == task.id
            )
        ).all()
        for row in rows:
            if similarity(text, row.progress) >= _DUPLICATE_THRESHOLD:
                return "task_update", row.id
    if operation.value == "create_blocker":
        text = payload.get("description", "")
        stmt = select(Blocker).where(Blocker.reported_session_id == session_id)
        if task:
            stmt = stmt.where(Blocker.task_id == task.id)
        for row in db.scalars(stmt).all():
            if similarity(text, row.description) >= _DUPLICATE_THRESHOLD:
                return "blocker", row.id
    if operation.value == "create_action_item":
        text = payload.get("description", "")
        for row in db.scalars(
            select(ActionItem).where(ActionItem.session_id == session_id)
        ).all():
            if similarity(text, row.description) >= _DUPLICATE_THRESHOLD:
                return "action_item", row.id
    if operation.value == "record_decision":
        text = payload.get("description", "")
        for row in db.scalars(
            select(Decision).where(Decision.session_id == session_id)
        ).all():
            if similarity(text, row.description) >= _DUPLICATE_THRESHOLD:
                return "decision", row.id
    if (
        operation.value == "update_task_status"
        and task
        and task.status.value == payload.get("status")
    ):
        return "task", task.id
    if (
        operation.value == "resolve_blocker"
        and blocker
        and blocker.status == BlockerStatus.RESOLVED
    ):
        return "blocker", blocker.id
    return None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def list_transcripts(db: Session, user: User) -> list[TranscriptOut]:
    require_manager(user)
    rows = db.scalars(
        select(Transcript).order_by(Transcript.created_at.desc()).limit(100)
    ).all()
    return [transcript_out(t) for t in rows]


def transcript_detail(db: Session, user: User, transcript_id: str) -> TranscriptDetail:
    require_manager(user)
    transcript = db.get(Transcript, transcript_id)
    if transcript is None:
        raise NotFoundError("Transcript not found")
    proposals = list(
        db.scalars(
            select(AiProposal)
            .where(AiProposal.transcript_id == transcript.id)
            .order_by(AiProposal.created_at.asc())
        ).all()
    )
    base = transcript_out(transcript)
    return TranscriptDetail(
        **base.model_dump(),
        proposal_count=len(proposals),
        pending_count=sum(1 for p in proposals if p.status == ProposalStatus.PENDING),
        proposals=[proposal_out(p) for p in proposals],
    )


def list_proposals(
    db: Session,
    user: User,
    *,
    status: ProposalStatus | None = None,
    transcript_id: str | None = None,
    session_id: str | None = None,
) -> list[ProposalOut]:
    require_manager(user)
    stmt = select(AiProposal)
    if status:
        stmt = stmt.where(AiProposal.status == status)
    if transcript_id:
        stmt = stmt.where(AiProposal.transcript_id == transcript_id)
    if session_id:
        stmt = stmt.where(AiProposal.session_id == session_id)
    rows = db.scalars(stmt.order_by(AiProposal.created_at.desc()).limit(200)).all()
    return [proposal_out(p) for p in rows]


def get_proposal(db: Session, user: User, proposal_id: str) -> AiProposal:
    require_manager(user)
    proposal = db.get(AiProposal, proposal_id)
    if proposal is None:
        raise NotFoundError("Proposal not found")
    return proposal


def edit_proposal(db: Session, user: User, proposal_id: str, payload: dict, note: str | None):
    proposal = get_proposal(db, user, proposal_id)
    if proposal.status != ProposalStatus.PENDING:
        raise ConflictError("Only pending proposals can be edited")
    previous = proposal.payload
    proposal.payload = payload
    if note is not None:
        proposal.review_note = note
    db.flush()
    record_event(
        db,
        event_type="ai_proposal.edited",
        entity_type="ai_proposal",
        entity_id=proposal.id,
        actor=user,
        source=AuditSource.AI_APPROVED,
        session_id=proposal.session_id,
        previous={"payload": previous},
        new={"payload": payload},
    )
    return proposal_out(proposal)


def approve_proposal(db: Session, user: User, proposal_id: str, note: str | None) -> ProposalOut:
    proposal = get_proposal(db, user, proposal_id)
    if proposal.status == ProposalStatus.APPLIED:
        return proposal_out(proposal)
    if proposal.status not in (ProposalStatus.PENDING, ProposalStatus.APPROVED):
        raise ConflictError(f"Cannot approve a {proposal.status.value} proposal")
    proposal.status = ProposalStatus.APPROVED
    proposal.reviewed_by_id = user.id
    proposal.reviewed_at = utcnow()
    if note:
        proposal.review_note = note
    db.flush()
    record_event(
        db,
        event_type="ai_proposal.approved",
        entity_type="ai_proposal",
        entity_id=proposal.id,
        actor=user,
        source=AuditSource.AI_APPROVED,
        session_id=proposal.session_id,
        new={"payload": proposal.payload},
    )
    return proposal_out(proposal)


def reject_proposal(db: Session, user: User, proposal_id: str, note: str | None) -> ProposalOut:
    proposal = get_proposal(db, user, proposal_id)
    if proposal.status == ProposalStatus.APPLIED:
        raise ConflictError("Applied proposals cannot be rejected")
    if proposal.status == ProposalStatus.REJECTED:
        return proposal_out(proposal)
    proposal.status = ProposalStatus.REJECTED
    proposal.reviewed_by_id = user.id
    proposal.reviewed_at = utcnow()
    proposal.review_note = note
    db.flush()
    record_event(
        db,
        event_type="ai_proposal.rejected",
        entity_type="ai_proposal",
        entity_id=proposal.id,
        actor=user,
        source=AuditSource.AI_APPROVED,
        session_id=proposal.session_id,
        new={"note": note},
    )
    return proposal_out(proposal)


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
def apply_proposal(db: Session, user: User, proposal_id: str) -> ProposalOut:
    require_manager(user)
    proposal = db.get(AiProposal, proposal_id)
    if proposal is None:
        raise NotFoundError("Proposal not found")
    if proposal.status == ProposalStatus.APPLIED:
        return proposal_out(proposal)
    if proposal.status != ProposalStatus.APPROVED:
        raise ConflictError("Proposal must be approved before it can be applied")

    try:
        result = _apply_operation(db, user, proposal)
    except ConflictError as exc:
        _mark_failed(db, proposal, user, exc.message)
        # Commit the failure state before surfacing 409 so the reviewer sees it.
        db.commit()
        raise
    except (DomainValidationError, NotFoundError) as exc:
        _mark_failed(db, proposal, user, getattr(exc, "message", str(exc)))
        db.commit()
        raise

    proposal.status = ProposalStatus.APPLIED
    proposal.applied_at = utcnow()
    proposal.reviewed_by_id = proposal.reviewed_by_id or user.id
    proposal.reviewed_at = proposal.reviewed_at or utcnow()
    db.flush()
    record_event(
        db,
        event_type="ai_proposal.applied",
        entity_type="ai_proposal",
        entity_id=proposal.id,
        actor=user,
        source=AuditSource.AI_APPROVED,
        session_id=proposal.session_id,
        new={"operation": proposal.operation.value, "result": result},
    )
    return proposal_out(proposal)


def _mark_failed(db: Session, proposal: AiProposal, user: User, reason: str) -> None:
    proposal.status = ProposalStatus.FAILED
    proposal.failure_reason = reason
    db.flush()
    record_event(
        db,
        event_type="ai_proposal.failed",
        entity_type="ai_proposal",
        entity_id=proposal.id,
        actor=user,
        source=AuditSource.AI_APPROVED,
        session_id=proposal.session_id,
        new={"reason": reason},
    )


def _ensure_fresh(task: Task, proposal: AiProposal) -> None:
    if proposal.base_task_version is not None and task.version != proposal.base_task_version:
        raise ConflictError(
            "Task changed after this proposal was generated. Re-evaluate before applying.",
            details={
                "current_version": task.version,
                "proposal_base_version": proposal.base_task_version,
            },
        )


def _ensure_no_duplicate_at_apply(
    db: Session, proposal: AiProposal, session_id: str | None, task: Task | None
) -> None:
    if not session_id:
        return
    duplicate = _detect_duplicate(
        db, session_id, proposal.operation, task, None, proposal.payload
    )
    if duplicate:
        raise ConflictError(
            "An equivalent record already exists in this session; not applying a duplicate.",
            details={"duplicate_of_type": duplicate[0], "duplicate_of_id": duplicate[1]},
        )


def _apply_operation(db: Session, user: User, proposal: AiProposal) -> dict:
    payload = proposal.payload or {}
    session_id = proposal.session_id

    if proposal.operation.value == "resolve_blocker":
        blocker_id = payload.get("blocker_id") or proposal.target_id
        if not blocker_id:
            raise DomainValidationError("Proposal has no target blocker")
        blocker = db.get(Blocker, blocker_id)
        if blocker is None:
            raise NotFoundError("Target blocker not found")
        if blocker.status == BlockerStatus.RESOLVED:
            raise ConflictError("Blocker is already resolved")
        resolved = resolve_blocker(
            db,
            user,
            blocker.id,
            payload.get("resolution_details") or "Resolved during standup",
            session_id=session_id,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "blocker", "entity_id": resolved.id}

    if proposal.operation.value == "record_decision":
        _ensure_no_duplicate_at_apply(db, proposal, session_id, None)
        decision = create_decision(
            db,
            user,
            DecisionCreate(
                description=payload.get("description", ""),
                rationale=payload.get("rationale"),
                task_id=proposal.target_id if proposal.target_type == TargetType.TASK else None,
            ),
            session_id=session_id,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "decision", "entity_id": decision.id}

    if proposal.operation.value == "create_action_item":
        _ensure_no_duplicate_at_apply(db, proposal, session_id, None)
        task = (
            db.get(Task, proposal.target_id)
            if proposal.target_type == TargetType.TASK and proposal.target_id
            else None
        )
        item = create_action_item(
            db,
            user,
            ActionItemCreate(
                description=payload.get("description", ""),
                owner_id=payload.get("owner_id") or (task.assignee_id if task else None),
                task_id=task.id if task else None,
                due_date=payload.get("due_date"),
            ),
            session_id=session_id,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "action_item", "entity_id": item.id}

    # Remaining operations target a task.
    if not proposal.target_id:
        raise DomainValidationError("Proposal has no target task")
    task = get_task_or_404(db, proposal.target_id)
    _ensure_fresh(task, proposal)

    if proposal.operation.value == "update_task_status":
        try:
            status = TaskStatus(payload.get("status"))
        except ValueError as exc:
            raise DomainValidationError("Invalid task status in proposal") from exc
        updated = patch_task(
            db,
            user,
            task.id,
            TaskPatch(status=status),
            session_id=session_id,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "task", "entity_id": updated.id, "status": status.value}

    if proposal.operation.value == "assign_task":
        assignee_id = payload.get("assignee_id")
        if not assignee_id:
            raise DomainValidationError("Proposal has no assignee")
        get_user_or_404(db, assignee_id)
        updated = patch_task(
            db,
            user,
            task.id,
            TaskPatch(assignee_id=assignee_id),
            session_id=session_id,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "task", "entity_id": updated.id, "assignee_id": assignee_id}

    if proposal.operation.value == "add_progress_update":
        _ensure_no_duplicate_at_apply(db, proposal, session_id, task)
        update = add_task_update(
            db,
            user,
            task,
            TaskUpdateCreate(
                progress=payload.get("progress", ""),
                next_steps=payload.get("next_steps"),
                attributed_to_user_id=payload.get("attributed_to_user_id")
                or task.assignee_id,
            ),
            session_id=session_id,
            source=UpdateSource.AI_APPROVED,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "task_update", "entity_id": update.id}

    if proposal.operation.value == "create_blocker":
        _ensure_no_duplicate_at_apply(db, proposal, session_id, task)
        blocker = create_blocker(
            db,
            user,
            BlockerCreate(
                description=payload.get("description", ""),
                task_id=task.id,
                owner_id=payload.get("owner_id") or task.assignee_id,
            ),
            session_id=session_id,
            audit_source=AuditSource.AI_APPROVED,
        )
        return {"entity_type": "blocker", "entity_id": blocker.id}

    raise DomainValidationError(f"Unsupported operation: {proposal.operation.value}")
