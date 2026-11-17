"""SQLAlchemy entities.

Design notes
------------
* Timestamps are stored as naive UTC. ``utcnow()`` is the single source of
  "now" so tests can freeze time by patching one function.
* ``Task.version`` is bumped on every accepted task mutation and is used for
  optimistic concurrency (including AI proposal application).
* Audit events and standup notes are append-only. Progress update text may be
  edited/deleted by its author or a manager; audit retains prior values.
* ``Blocker`` is intentionally separate from ``Task.status``: a task stays
  ``in_progress`` while it has an open blocker.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.enums import (
    ActionItemStatus,
    ActorType,
    AuditSource,
    BlockerStatus,
    IntakeStatus,
    Priority,
    ProjectMemberRole,
    ProjectStatus,
    ProposalOperation,
    ProposalStatus,
    Role,
    SessionStatus,
    TargetType,
    TaskStatus,
    TranscriptStatus,
    UpdateSource,
)


def utcnow() -> datetime:
    """Naive UTC timestamp, used for every ``created_at``/``updated_at``."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return str(uuid.uuid4())


def enum_col(enum_cls, length: int = 32):
    return SAEnum(
        enum_cls,
        native_enum=False,
        length=length,
        validate_strings=True,
        values_callable=lambda e: [member.value for member in e],
    )


class Base(DeclarativeBase):
    pass


class UUIDMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class PublicIdSequence(Base):
    """Per-kind counter backing human-readable public ids (TASK-/PROJ-)."""

    __tablename__ = "public_id_sequences"

    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    external_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[Role] = mapped_column(enum_col(Role), default=Role.EMPLOYEE, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    standup_eligible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    owned_projects: Mapped[list[Project]] = relationship(
        back_populates="owner", foreign_keys="Project.owner_id"
    )
    memberships: Mapped[list[ProjectMember]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_manager(self) -> bool:
        return self.role in (Role.MANAGER, Role.ADMIN)


class Project(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "projects"

    # Human-readable immutable handle (PROJ-<n>); the UUID ``id`` stays primary.
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Stable designation for system-provisioned projects (currently ``ad_hoc``).
    system_key: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[ProjectStatus] = mapped_column(
        enum_col(ProjectStatus), default=ProjectStatus.ACTIVE, nullable=False
    )

    owner: Mapped[User | None] = relationship(
        back_populates="owned_projects", foreign_keys=[owner_id]
    )
    members: Mapped[list[ProjectMember]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    tasks: Mapped[list[Task]] = relationship(back_populates="project")


class ProjectMember(UUIDMixin, Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[ProjectMemberRole] = mapped_column(
        enum_col(ProjectMemberRole), default=ProjectMemberRole.MEMBER, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
class Task(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_assignee_status", "assignee_id", "status"),
        Index("ix_tasks_project_status", "project_id", "status"),
    )

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Human-readable immutable handle (TASK-<n>); the UUID ``id`` stays primary.
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Free-text "Blocked by" note. Independent of the legacy Blocker rows.
    blocked_by: Mapped[str | None] = mapped_column(Text)
    assignee_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    priority: Mapped[Priority] = mapped_column(
        enum_col(Priority), default=Priority.MEDIUM, nullable=False
    )
    status: Mapped[TaskStatus] = mapped_column(
        enum_col(TaskStatus), default=TaskStatus.TODO, nullable=False
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    client_operation_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )

    project: Mapped[Project] = relationship(back_populates="tasks")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    updates: Mapped[list[TaskUpdate]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskUpdate.created_at"
    )
    blockers: Mapped[list[Blocker]] = relationship(back_populates="task")
    decisions: Mapped[list[Decision]] = relationship(back_populates="task")
    action_items: Mapped[list[ActionItem]] = relationship(back_populates="task")


class TaskUpdate(UUIDMixin, Base):
    """Progress update. Historic text may be edited/deleted by its author; audit stays append-only."""

    __tablename__ = "task_updates"
    __table_args__ = (Index("ix_task_updates_task_created", "task_id", "created_at"),)

    task_id: Mapped[str] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Who the update is *about* (manager capturing on behalf of an employee).
    attributed_to_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL"), index=True
    )
    source: Mapped[UpdateSource] = mapped_column(
        enum_col(UpdateSource), default=UpdateSource.TASK_INTERFACE, nullable=False
    )
    progress: Mapped[str] = mapped_column(Text, nullable=False)
    next_steps: Mapped[str | None] = mapped_column(Text)
    # Snapshot of the task's free-text "Blocked by" value at capture time, so
    # historical updates can render the state they recorded.
    blocked_by: Mapped[str | None] = mapped_column(Text)
    # Client-generated logical submission id. A retry with the same id returns
    # the original row instead of creating a duplicate update.
    client_operation_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    task: Mapped[Task] = relationship(back_populates="updates")
    author: Mapped[User | None] = relationship(foreign_keys=[author_id])
    attributed_to: Mapped[User | None] = relationship(foreign_keys=[attributed_to_user_id])
    session: Mapped[StandupSession | None] = relationship()


class Blocker(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "blockers"
    __table_args__ = (
        Index("ix_blockers_status_task", "status", "task_id"),
        Index("ix_blockers_owner_status", "owner_id", "status"),
    )

    task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    reported_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reported_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[BlockerStatus] = mapped_column(
        enum_col(BlockerStatus), default=BlockerStatus.OPEN, nullable=False, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    resolved_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL")
    )
    resolution_details: Mapped[str | None] = mapped_column(Text)
    client_operation_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )

    task: Mapped[Task | None] = relationship(back_populates="blockers")
    project: Mapped[Project | None] = relationship()
    owner: Mapped[User | None] = relationship(foreign_keys=[owner_id])
    reported_by: Mapped[User | None] = relationship(foreign_keys=[reported_by_id])
    reported_session: Mapped[StandupSession | None] = relationship(
        foreign_keys=[reported_session_id]
    )
    resolved_by: Mapped[User | None] = relationship(foreign_keys=[resolved_by_id])
    resolved_session: Mapped[StandupSession | None] = relationship(
        foreign_keys=[resolved_session_id]
    )


# ---------------------------------------------------------------------------
# Standups
# ---------------------------------------------------------------------------
class StandupSession(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "standup_sessions"

    session_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True, index=True)
    status: Mapped[SessionStatus] = mapped_column(
        enum_col(SessionStatus), default=SessionStatus.DRAFT, nullable=False
    )
    facilitator_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    summary: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    facilitator: Mapped[User | None] = relationship(foreign_keys=[facilitator_id])
    participants: Mapped[list[StandupParticipant]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class StandupParticipant(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "standup_participants"
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_participant_session_user"),
    )

    session_id: Mapped[str] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pre_meeting_progress: Mapped[str | None] = mapped_column(Text)
    pre_meeting_next_steps: Mapped[str | None] = mapped_column(Text)
    pre_meeting_blockers: Mapped[str | None] = mapped_column(Text)
    pre_meeting_submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    reviewed_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    follow_up_flagged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    follow_up_note: Mapped[str | None] = mapped_column(Text)

    session: Mapped[StandupSession] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])


class Decision(UUIDMixin, Base):
    __tablename__ = "decisions"

    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL"), index=True
    )
    task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text)
    decided_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    responsible_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    client_operation_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    session: Mapped[StandupSession | None] = relationship()
    task: Mapped[Task | None] = relationship(back_populates="decisions")
    project: Mapped[Project | None] = relationship()
    decided_by: Mapped[User | None] = relationship(foreign_keys=[decided_by_id])
    responsible_user: Mapped[User | None] = relationship(foreign_keys=[responsible_user_id])


class ActionItem(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "action_items"
    __table_args__ = (Index("ix_action_items_status_owner", "status", "owner_id"),)

    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL"), index=True
    )
    task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[ActionItemStatus] = mapped_column(
        enum_col(ActionItemStatus), default=ActionItemStatus.OPEN, nullable=False, index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    client_operation_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )

    session: Mapped[StandupSession | None] = relationship()
    task: Mapped[Task | None] = relationship(back_populates="action_items")
    owner: Mapped[User | None] = relationship(foreign_keys=[owner_id])
    completed_by: Mapped[User | None] = relationship(foreign_keys=[completed_by_id])


class DailyUpdate(UUIDMixin, TimestampMixin, Base):
    """One optional short update per employee per day.

    This is the simplified replacement for the multi-question pre-meeting form.
    It exists independently of a standup session so employees can report a
    change before the manager opens the meeting.
    """

    __tablename__ = "daily_updates"
    __table_args__ = (
        UniqueConstraint("user_id", "update_date", name="uq_daily_update_user_date"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    update_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    progress: Mapped[str] = mapped_column(Text, nullable=False)
    next_steps: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship()


class SessionNote(UUIDMixin, Base):
    __tablename__ = "session_notes"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    client_operation_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    session: Mapped[StandupSession] = relationship()
    author: Mapped[User | None] = relationship()


# ---------------------------------------------------------------------------
# Work intake
# ---------------------------------------------------------------------------
class IntakeRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "intake_requests"

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    requester_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    requester_name: Mapped[str | None] = mapped_column(String(200))
    priority: Mapped[Priority] = mapped_column(
        enum_col(Priority), default=Priority.MEDIUM, nullable=False
    )
    status: Mapped[IntakeStatus] = mapped_column(
        enum_col(IntakeStatus), default=IntakeStatus.NEW, nullable=False, index=True
    )
    reviewed_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    review_note: Mapped[str | None] = mapped_column(Text)
    converted_task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL")
    )
    converted_project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )

    requester: Mapped[User | None] = relationship(foreign_keys=[requester_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])
    converted_task: Mapped[Task | None] = relationship(foreign_keys=[converted_task_id])
    converted_project: Mapped[Project | None] = relationship(
        foreign_keys=[converted_project_id]
    )


# ---------------------------------------------------------------------------
# AI transcript reconciliation (Phase 4)
# ---------------------------------------------------------------------------
class Transcript(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "transcripts"

    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL"), index=True
    )
    filename: Mapped[str] = mapped_column(String(400), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120))
    storage_key: Mapped[str | None] = mapped_column(String(600))
    content_text: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[TranscriptStatus] = mapped_column(
        enum_col(TranscriptStatus), default=TranscriptStatus.UPLOADED, nullable=False
    )
    error: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)

    session: Mapped[StandupSession | None] = relationship()
    uploaded_by: Mapped[User | None] = relationship()
    proposals: Mapped[list[AiProposal]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan"
    )


class AiProposal(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "ai_proposals"
    __table_args__ = (Index("ix_ai_proposals_status_created", "status", "created_at"),)

    transcript_id: Mapped[str] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL"), index=True
    )
    operation: Mapped[ProposalOperation] = mapped_column(
        enum_col(ProposalOperation, length=48), nullable=False
    )
    target_type: Mapped[TargetType] = mapped_column(enum_col(TargetType), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(36), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    current_values: Mapped[dict | None] = mapped_column(JSON)
    evidence_excerpt: Mapped[str | None] = mapped_column(Text)
    speaker: Mapped[str | None] = mapped_column(String(200))
    spoken_at: Mapped[str | None] = mapped_column(String(40))
    confidence: Mapped[float | None] = mapped_column(Float)
    is_ambiguous: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duplicate_of_type: Mapped[str | None] = mapped_column(String(32))
    duplicate_of_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[ProposalStatus] = mapped_column(
        enum_col(ProposalStatus), default=ProposalStatus.PENDING, nullable=False, index=True
    )
    base_task_version: Mapped[int | None] = mapped_column(Integer)
    reviewed_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_note: Mapped[str | None] = mapped_column(Text)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime)
    failure_reason: Mapped[str | None] = mapped_column(Text)

    transcript: Mapped[Transcript] = relationship(back_populates="proposals")
    session: Mapped[StandupSession | None] = relationship()
    reviewed_by: Mapped[User | None] = relationship()


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
class AuditEvent(UUIDMixin, Base):
    """Append-only. Written in the same transaction as the mutation it records."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id", "occurred_at"),
        Index("ix_audit_session", "session_id", "occurred_at"),
    )

    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_type: Mapped[ActorType] = mapped_column(
        enum_col(ActorType), default=ActorType.USER, nullable=False
    )
    actor_label: Mapped[str | None] = mapped_column(String(200))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, index=True
    )
    previous_values: Mapped[dict | None] = mapped_column(JSON)
    new_values: Mapped[dict | None] = mapped_column(JSON)
    source: Mapped[AuditSource] = mapped_column(enum_col(AuditSource), nullable=False)
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("standup_sessions.id", ondelete="SET NULL")
    )
    context: Mapped[dict | None] = mapped_column(JSON)

    actor: Mapped[User | None] = relationship()
    session: Mapped[StandupSession | None] = relationship()


# Register public-id allocators last: every Task/Project ORM insert (services,
# seed, test fixtures, Ad hoc provisioning) is assigned TASK-<n>/PROJ-<n>.
from app.core.public_ids import install_public_id_listeners  # noqa: E402

install_public_id_listeners()
