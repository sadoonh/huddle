"""ORM -> API serializers.

Pydantic's ``from_attributes`` handles plain fields and nested users. Computed
fields (blocked / overdue / age / reasons) are filled here so every endpoint
returns the same shape.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import ActionItemStatus, BlockerStatus, TaskStatus
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


def user_brief(user: User | None) -> UserBrief | None:
    if user is None:
        return None
    return UserBrief.model_validate(user)


def task_update_out(update: TaskUpdate) -> TaskUpdateOut:
    return TaskUpdateOut.model_validate(update)


def task_out(task: Task) -> TaskOut:
    out = TaskOut.model_validate(task)
    open_blockers = [b for b in task.blockers if b.status == BlockerStatus.OPEN]
    out.project_name = task.project.name if task.project else None
    out.is_blocked = bool(open_blockers)
    out.open_blocker_count = len(open_blockers)
    out.open_action_item_count = sum(
        1 for item in task.action_items if item.status == ActionItemStatus.OPEN
    )
    out.is_overdue = bool(
        task.due_date
        and task.due_date < date.today()
        and task.status not in TaskStatus.closed_statuses()
    )
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
) -> ParticipantOut:
    out = ParticipantOut.model_validate(participant)
    out.open_blocker_count = open_blocker_count
    out.open_action_item_count = open_action_item_count
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
    base = task_out(task)
    open_blockers = [b for b in task.blockers if b.status == BlockerStatus.OPEN]
    open_actions = [a for a in task.action_items if a.status == ActionItemStatus.OPEN]

    reasons: list[str] = []
    if open_blockers:
        reasons.append("blocker")
    if base.is_overdue:
        reasons.append("overdue")
    if task.is_at_risk:
        reasons.append("at_risk")
    if open_actions:
        reasons.append("follow_up")
    if not reasons and task.status == TaskStatus.IN_PROGRESS:
        reasons.append("in_progress")
    if task.due_date and not base.is_overdue and task.due_date <= date.today():
        reasons.append("due_soon")

    return WorkspaceTask(
        **base.model_dump(),
        open_blockers=[blocker_out(b) for b in open_blockers],
        open_action_items=[action_item_out(a) for a in open_actions],
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
