from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from app.enums import (
    ActionItemStatus,
    AuditSource,
    BlockerStatus,
    Priority,
    ProposalOperation,
    ProposalStatus,
    Role,
    TargetType,
    TaskStatus,
    UpdateSource,
)
from app.schemas.common import ORMModel, UserBrief


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
class TaskCreate(ORMModel):
    project_id: str
    title: str = Field(min_length=1, max_length=300)
    client_operation_id: str | None = Field(default=None, max_length=64)
    description: str | None = None
    assignee_id: str | None = None
    priority: Priority = Priority.MEDIUM
    status: TaskStatus = TaskStatus.TODO
    due_date: date | None = None
    # Free-text "Blocked by" note; blank/whitespace is stored as NULL.
    blocked_by: str | None = None


class TaskPatch(ORMModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    project_id: str | None = None
    assignee_id: str | None = None
    priority: Priority | None = None
    status: TaskStatus | None = None
    due_date: date | None = None
    # Omitted = unchanged; explicit null/blank = clear.
    blocked_by: str | None = None
    # Optimistic concurrency: when supplied and stale the API returns 409.
    expected_version: int | None = None


class TaskStatusChange(ORMModel):
    status: TaskStatus
    expected_version: int | None = None


class TaskUpdateCreate(ORMModel):
    progress: str = Field(min_length=1)
    next_steps: str | None = None
    attributed_to_user_id: str | None = None
    # Optional atomic status change in the same transaction.
    status: TaskStatus | None = None
    expected_version: int | None = None
    client_operation_id: str | None = Field(default=None, max_length=64)


class TaskUpdatePatch(ORMModel):
    progress: str = Field(min_length=1)
    # Omitted preserves the existing value; explicit null/blank clears it.
    next_steps: str | None = None
    expected_version: int | None = None


class TaskUpdateOut(ORMModel):
    id: str
    task_id: str
    task_title: str | None = None
    task_public_id: str | None = None
    progress: str
    next_steps: str | None
    source: UpdateSource
    author: UserBrief | None
    attributed_to: UserBrief | None
    session_id: str | None
    created_at: datetime


class BlockerCreate(ORMModel):
    description: str = Field(min_length=1)
    task_id: str | None = None
    project_id: str | None = None
    owner_id: str | None = None
    client_operation_id: str | None = Field(default=None, max_length=64)


class BlockerResolve(ORMModel):
    resolution_details: str = Field(min_length=1)


class BlockerOut(ORMModel):
    id: str
    task_id: str | None
    project_id: str | None
    task_title: str | None = None
    description: str
    status: BlockerStatus
    owner: UserBrief | None
    reported_by: UserBrief | None
    reported_session_id: str | None
    resolution_details: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Days the blocker has been open, computed for exception-first sorting.
    age_days: int = 0


class ActionItemCreate(ORMModel):
    description: str = Field(min_length=1)
    owner_id: str | None = None
    task_id: str | None = None
    due_date: date | None = None
    client_operation_id: str | None = Field(default=None, max_length=64)


class ActionItemPatch(ORMModel):
    status: ActionItemStatus | None = None
    owner_id: str | None = None
    due_date: date | None = None
    description: str | None = Field(default=None, min_length=1)


class ActionItemOut(ORMModel):
    id: str
    session_id: str | None
    task_id: str | None
    task_title: str | None = None
    description: str
    status: ActionItemStatus
    owner: UserBrief | None
    due_date: date | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DecisionCreate(ORMModel):
    description: str = Field(min_length=1)
    task_id: str | None = None
    project_id: str | None = None
    rationale: str | None = None
    responsible_user_id: str | None = None
    client_operation_id: str | None = Field(default=None, max_length=64)


class DecisionOut(ORMModel):
    id: str
    session_id: str | None
    task_id: str | None
    task_title: str | None = None
    project_id: str | None
    description: str
    rationale: str | None
    decided_by: UserBrief | None
    responsible_user: UserBrief | None
    created_at: datetime


class TaskOut(ORMModel):
    id: str
    public_id: str
    project_id: str
    project_name: str | None = None
    title: str
    description: str | None
    assignee: UserBrief | None
    priority: Priority
    status: TaskStatus
    due_date: date | None
    blocked_by: str | None = None
    completed_at: datetime | None
    version: int
    created_at: datetime
    updated_at: datetime
    is_blocked: bool = False
    is_overdue: bool = False
    open_blocker_count: int = 0
    open_action_item_count: int = 0
    # Server-computed capability: may the current user change status/move this task?
    can_move: bool = False
    latest_update: TaskUpdateOut | None = None


class TaskDetail(TaskOut):
    updates: list[TaskUpdateOut] = Field(default_factory=list)
    blockers: list[BlockerOut] = Field(default_factory=list)
    action_items: list[ActionItemOut] = Field(default_factory=list)
    decisions: list[DecisionOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
class AuditEventOut(ORMModel):
    id: str
    event_type: str
    entity_type: str
    entity_id: str
    actor: UserBrief | None
    actor_type: str
    actor_label: str | None
    occurred_at: datetime
    previous_values: dict | None
    new_values: dict | None
    source: AuditSource
    session_id: str | None
    context: dict | None


# ---------------------------------------------------------------------------
# AI proposals (Phase 4)
# ---------------------------------------------------------------------------
class ProposalOut(ORMModel):
    id: str
    transcript_id: str
    session_id: str | None
    operation: ProposalOperation
    target_type: TargetType
    target_id: str | None
    payload: dict
    current_values: dict | None
    evidence_excerpt: str | None
    speaker: str | None
    spoken_at: str | None
    confidence: float | None
    is_ambiguous: bool
    duplicate_of_type: str | None
    duplicate_of_id: str | None
    status: ProposalStatus
    base_task_version: int | None
    reviewed_by: UserBrief | None
    reviewed_at: datetime | None
    review_note: str | None
    applied_at: datetime | None
    failure_reason: str | None
    created_at: datetime
    updated_at: datetime


class ProposalEdit(ORMModel):
    payload: dict
    review_note: str | None = None


class ReviewAction(ORMModel):
    note: str | None = None


class TranscriptOut(ORMModel):
    id: str
    session_id: str | None
    filename: str
    content_type: str | None
    size_bytes: int
    status: str
    error: str | None
    uploaded_by: UserBrief | None
    processed_at: datetime | None
    created_at: datetime


class TranscriptDetail(TranscriptOut):
    proposal_count: int = 0
    pending_count: int = 0
    proposals: list[ProposalOut] = Field(default_factory=list)


class RoleOut(ORMModel):
    value: Role
