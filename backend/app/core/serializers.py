"""ORM -> API serializers.

Pydantic's ``from_attributes`` handles plain fields and nested users. Computed
fields (blocked / overdue / age / reasons) are filled here so every endpoint
returns the same shape.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import ActionItemStatus, BlockerStatus
from app.models import (
    ActionItem,
    AiProposal,
    AuditEvent,
    Blocker,
    Decision,
    StandupParticipant,
    StandupSession,
    Task,
    TaskUpdate,
    Transcript,
    User,
    utcnow,
)
from app.schemas.common import UserBrief
from app.schemas.standups import (
    CarriedItem,
    ParticipantOut,
    SessionOut,
    SessionSummaryOut,
    WorkspaceTask,
)
from app.schemas.tasks import (
    ActionItemOut,
    AuditEventOut,
    BlockerOut,
    DecisionOut,
    ProposalOut,
    TaskOut,
    TaskUpdateOut,
    TranscriptOut,
)
from app.schemas.today import DailyUpdateOut


def user_brief(user: User | None) -> UserBrief | None:
    if user is None:
        return None
    return UserBrief.model_validate(user)


def task_update_out(update: TaskUpdate) -> TaskUpdateOut:
    out = TaskUpdateOut.model_validate(update)
    out.task_title = update.task.title if update.task else None
    out.task_public_id = update.task.public_id if update.task else None
    return out


def task_out(task: Task, user: User | None = None) -> TaskOut:
    """Serialize a task; pass ``user`` to fill the movement capability."""
    out = TaskOut.model_validate(task)
    if user is not None:
        from app.core.rbac import can_edit_task

        out.can_move = can_edit_task(user, task)
    # The active product derives "blocked" from free text only. Legacy Blocker
    # rows and action items are kept for history but never populate active
    # flags/counts, and due dates no longer mark tasks overdue.
    out.is_blocked = bool(task.blocked_by and task.blocked_by.strip())
    out.open_blocker_count = 0
    out.open_action_item_count = 0
    out.is_overdue = False
    out.project_name = task.project.name if task.project else None
    out.latest_update = task_update_out(task.updates[-1]) if task.updates else None
    return out


def blocker_out(blocker: Blocker) -> BlockerOut:
    out = BlockerOut.model_validate(blocker)
    out.task_title = blocker.task.title if blocker.task else None
    if blocker.status == BlockerStatus.OPEN:
        out.age_days = max((utcnow().date() - blocker.created_at.date()).days, 0)
    return out


def action_item_out(item: ActionItem) -> ActionItemOut:
    out = ActionItemOut.model_validate(item)
    out.task_title = item.task.title if item.task else None
    return out


def decision_out(decision: Decision) -> DecisionOut:
    out = DecisionOut.model_validate(decision)
    out.task_title = decision.task.title if decision.task else None
    return out


def participant_out(
    participant: StandupParticipant,
    *,
    open_blocker_count: int = 0,
    open_action_item_count: int = 0,
    has_daily_update: bool = False,
    daily_update=None,
) -> ParticipantOut:
    out = ParticipantOut.model_validate(participant)
    out.open_blocker_count = open_blocker_count
    out.open_action_item_count = open_action_item_count
    out.has_daily_update = has_daily_update
    out.daily_update = (
        DailyUpdateOut.model_validate(daily_update) if daily_update is not None else None
    )
    return out


def session_out(
    session: StandupSession,
    *,
    open_blocker_count: int = 0,
    open_action_item_count: int = 0,
) -> SessionOut:
    out = SessionOut.model_validate(session)
    out.participant_count = len(session.participants)
    out.reviewed_count = sum(1 for p in session.participants if p.reviewed_at is not None)
    out.open_blocker_count = open_blocker_count
    out.open_action_item_count = open_action_item_count
    return out


def session_counts(db: Session, session_ids: list[str]) -> dict[str, tuple[int, int]]:
    """Bulk (open blockers, open action items) for session list/detail badges."""
    result: dict[str, tuple[int, int]] = {sid: (0, 0) for sid in session_ids}
    if not session_ids:
        return result

    blockers = db.execute(
        select(Blocker.reported_session_id, func.count(Blocker.id))
        .where(
            Blocker.reported_session_id.in_(session_ids),
            Blocker.status == BlockerStatus.OPEN,
        )
        .group_by(Blocker.reported_session_id)
    ).all()
    actions = db.execute(
        select(ActionItem.session_id, func.count(ActionItem.id))
        .where(
            ActionItem.session_id.in_(session_ids),
            ActionItem.status == ActionItemStatus.OPEN,
        )
        .group_by(ActionItem.session_id)
    ).all()
    for sid, count in blockers:
        current = result.setdefault(sid, (0, 0))
        result[sid] = (count, current[1])
    for sid, count in actions:
        current = result.setdefault(sid, (0, 0))
        result[sid] = (current[0], count)
    return result


def workspace_task(task: Task) -> WorkspaceTask:
    """Active workspace card: free-text attention only, no legacy issue arrays."""
    base = task_out(task)
    reasons: list[str] = ["blocked"] if base.is_blocked else []
    return WorkspaceTask(
        **base.model_dump(),
        open_blockers=[],
        open_action_items=[],
        reasons=reasons,
    )


def carried_blocker(blocker: Blocker) -> CarriedItem:
    return CarriedItem(
        kind="blocker",
        id=blocker.id,
        description=blocker.description,
        task_id=blocker.task_id,
        task_title=blocker.task.title if blocker.task else None,
        owner=user_brief(blocker.owner),
        origin_session_id=blocker.reported_session_id,
        origin_session_date=blocker.reported_session.session_date
        if blocker.reported_session
        else None,
        age_days=max((utcnow().date() - blocker.created_at.date()).days, 0),
    )


def carried_action_item(item: ActionItem) -> CarriedItem:
    return CarriedItem(
        kind="action_item",
        id=item.id,
        description=item.description,
        task_id=item.task_id,
        task_title=item.task.title if item.task else None,
        owner=user_brief(item.owner),
        origin_session_id=item.session_id,
        origin_session_date=item.session.session_date if item.session else None,
        age_days=max((utcnow().date() - item.created_at.date()).days, 0),
        due_date=item.due_date,
    )


def audit_out(event: AuditEvent) -> AuditEventOut:
    return AuditEventOut.model_validate(event)


def proposal_out(proposal: AiProposal) -> ProposalOut:
    return ProposalOut.model_validate(proposal)


def transcript_out(transcript: Transcript) -> TranscriptOut:
    out = TranscriptOut.model_validate(transcript)
    out.status = transcript.status.value
    return out


def summary_out(
    session: StandupSession,
    *,
    updates: int,
    blockers_created: int,
    blockers_resolved: int,
    decisions: int,
    action_items: int,
    open_action_items: int,
    summary_text: str,
    session_schema: SessionOut,
) -> SessionSummaryOut:
    unreviewed = [
        UserBrief.model_validate(p.user) for p in session.participants if p.reviewed_at is None
    ]
    return SessionSummaryOut(
        session=session_schema,
        reviewed_count=sum(1 for p in session.participants if p.reviewed_at is not None),
        unreviewed=unreviewed,
        updates=updates,
        blockers_created=blockers_created,
        blockers_resolved=blockers_resolved,
        decisions=decisions,
        action_items=action_items,
        open_action_items=open_action_items,
        summary_text=summary_text,
    )
