from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from app.enums import SessionStatus
from app.schemas.common import ORMModel, UserBrief
from app.schemas.tasks import (
    ActionItemOut,
    BlockerOut,
    DecisionOut,
    TaskOut,
    TaskUpdateOut,
)
from app.schemas.today import DailyUpdateOut


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
class SessionCreate(ORMModel):
    session_date: date | None = None
    facilitator_id: str | None = None
    participant_ids: list[str] | None = None


class SessionOut(ORMModel):
    id: str
    session_date: date
    status: SessionStatus
    facilitator: UserBrief | None
    started_at: datetime | None
    ended_at: datetime | None
    summary: str | None
    notes: str | None
    participant_count: int = 0
    reviewed_count: int = 0
    open_blocker_count: int = 0
    open_action_item_count: int = 0
    created_at: datetime
    updated_at: datetime


class ParticipantOut(ORMModel):
    id: str
    user: UserBrief
    pre_meeting_progress: str | None
    pre_meeting_next_steps: str | None
    pre_meeting_blockers: str | None
    pre_meeting_submitted_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: UserBrief | None
    follow_up_flagged: bool
    follow_up_note: str | None
    open_blocker_count: int = 0
    open_action_item_count: int = 0
    has_daily_update: bool = False


class SessionDetail(SessionOut):
    participants: list[ParticipantOut] = Field(default_factory=list)


class SessionOutcomes(ORMModel):
    action_items: list[ActionItemOut] = Field(default_factory=list)
    unresolved_blockers: list[CarriedItem] = Field(default_factory=list)
    decisions: list[DecisionOut] = Field(default_factory=list)
    updates_count: int = 0
    participant_count: int = 0
    reviewed_count: int = 0


class PreMeetingTaskUpdate(ORMModel):
    task_id: str
    progress: str = Field(min_length=1)
    next_steps: str | None = None


class PreMeetingSubmit(ORMModel):
    progress: str | None = None
    next_steps: str | None = None
    blockers: str | None = None
    task_updates: list[PreMeetingTaskUpdate] = Field(default_factory=list)


class ParticipantPatch(ORMModel):
    reviewed: bool | None = None
    follow_up_flagged: bool | None = None
    follow_up_note: str | None = None


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------
class WorkspaceTask(TaskOut):
    open_blockers: list[BlockerOut] = Field(default_factory=list)
    open_action_items: list[ActionItemOut] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)


class CarriedItem(ORMModel):
    kind: str  # blocker | action_item | follow_up
    id: str
    description: str
    task_id: str | None = None
    task_title: str | None = None
    owner: UserBrief | None = None
    origin_session_id: str | None = None
    origin_session_date: date | None = None
    age_days: int = 0
    due_date: date | None = None


class ParticipantWorkspace(ORMModel):
    session_id: str
    participant: ParticipantOut
    daily_update: DailyUpdateOut | None = None
    needs_attention: list[WorkspaceTask] = Field(default_factory=list)
    active: list[WorkspaceTask] = Field(default_factory=list)
    other: list[WorkspaceTask] = Field(default_factory=list)
    carried_blockers: list[CarriedItem] = Field(default_factory=list)
    carried_action_items: list[CarriedItem] = Field(default_factory=list)
    recent_updates: list[TaskUpdateOut] = Field(default_factory=list)
    recent_decisions: list[DecisionOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# In-meeting capture
# ---------------------------------------------------------------------------
class ProgressCapture(ORMModel):
    task_id: str
    progress: str = Field(min_length=1)
    next_steps: str | None = None
    attributed_to_user_id: str | None = None


class MeetingBlockerCreate(ORMModel):
    description: str = Field(min_length=1)
    task_id: str | None = None
    owner_id: str | None = None
    attributed_to_user_id: str | None = None


class MeetingActionItemCreate(ORMModel):
    description: str = Field(min_length=1)
    owner_id: str | None = None
    task_id: str | None = None
    due_date: date | None = None


class MeetingDecisionCreate(ORMModel):
    description: str = Field(min_length=1)
    task_id: str | None = None
    project_id: str | None = None
    rationale: str | None = None
    responsible_user_id: str | None = None


class SessionNoteCreate(ORMModel):
    body: str = Field(min_length=1)


class SessionNoteOut(ORMModel):
    id: str
    session_id: str
    body: str
    author: UserBrief | None
    created_at: datetime


class SessionCaptures(ORMModel):
    updates: list[TaskUpdateOut] = Field(default_factory=list)
    blockers: list[BlockerOut] = Field(default_factory=list)
    action_items: list[ActionItemOut] = Field(default_factory=list)
    decisions: list[DecisionOut] = Field(default_factory=list)
    notes: list[SessionNoteOut] = Field(default_factory=list)


class CompleteSessionRequest(ORMModel):
    notes: str | None = None
    force: bool = False


class SessionSummaryOut(ORMModel):
    session: SessionOut
    reviewed_count: int
    unreviewed: list[UserBrief]
    updates: int
    blockers_created: int
    blockers_resolved: int
    decisions: int
    action_items: int
    open_action_items: int
    summary_text: str


class SessionHistoryEntry(ORMModel):
    session: SessionOut
    participant: ParticipantOut
    updates: list[TaskUpdateOut] = Field(default_factory=list)
    blockers_reported: list[BlockerOut] = Field(default_factory=list)
    blockers_resolved: list[BlockerOut] = Field(default_factory=list)
    decisions: list[DecisionOut] = Field(default_factory=list)
    action_items: list[ActionItemOut] = Field(default_factory=list)


class UserStandupHistory(ORMModel):
    user: UserBrief
    entries: list[SessionHistoryEntry] = Field(default_factory=list)


class CarryForwardOut(ORMModel):
    blockers: list[CarriedItem] = Field(default_factory=list)
    action_items: list[CarriedItem] = Field(default_factory=list)
    at_risk_tasks: list[TaskOut] = Field(default_factory=list)
    overdue_tasks: list[TaskOut] = Field(default_factory=list)
