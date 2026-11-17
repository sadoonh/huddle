from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from app.enums import SessionStatus, TaskStatus
from app.schemas.common import ORMModel, Page, UserBrief
from app.schemas.tasks import ActionItemOut, BlockerOut, TaskOut


class DailyUpdateIn(ORMModel):
    progress: str = Field(min_length=1)
    next_steps: str | None = None


class DailyUpdateOut(ORMModel):
    id: str
    user_id: str
    update_date: date
    progress: str
    next_steps: str | None
    created_at: datetime
    updated_at: datetime


class TodaySession(ORMModel):
    id: str
    session_date: date
    status: SessionStatus
    facilitator: UserBrief | None
    reviewed_count: int = 0
    participant_count: int = 0


class AttentionIssue(ORMModel):
    kind: str  # blocker | action_item | reason
    id: str
    label: str
    detail: str | None = None
    owner: UserBrief | None = None
    due_date: date | None = None
    age_days: int = 0


class AttentionItem(ORMModel):
    kind: str  # task | blocker | action_item
    id: str
    task_id: str | None = None
    focus_id: str | None = None
    title: str
    detail: str | None = None
    owner: UserBrief | None = None
    reporter: UserBrief | None = None
    reason: str
    reasons: list[str] = Field(default_factory=list)
    issues: list[AttentionIssue] = Field(default_factory=list)
    due_date: date | None = None
    age_days: int = 0
    task_status: TaskStatus | None = None
    open_blocker_count: int = 0
    open_action_item_count: int = 0
    origin_session_date: date | None = None


class TodayTask(TaskOut):
    """A task row with the exception context that makes it relevant today."""
    reasons: list[str] = Field(default_factory=list)
    open_blockers: list[BlockerOut] = Field(default_factory=list)
    open_action_items: list[ActionItemOut] = Field(default_factory=list)


class TodayOut(ORMModel):
    business_date: date
    session: TodaySession | None
    daily_update: DailyUpdateOut | None
    # Change boundary and its human label ("since the Nov 12 standup").
    cutoff: datetime | None
    cutoff_label: str
    checkin: Page[TodayTask]
    other_commitments: list[AttentionItem] = Field(default_factory=list)
    recently_completed: Page[TaskOut]
