"""Domain enumerations.

Values are stored as strings in the database (no native PostgreSQL enums) so
migrations stay simple, while the Python enums keep the API strict.
"""

from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    EMPLOYEE = "employee"
    MANAGER = "manager"
    ADMIN = "admin"


class ProjectStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ProjectMemberRole(str, Enum):
    LEAD = "lead"
    MEMBER = "member"


class TaskStatus(str, Enum):
    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELED = "canceled"

    @classmethod
    def open_statuses(cls) -> tuple[TaskStatus, ...]:
        return (cls.BACKLOG, cls.TODO, cls.IN_PROGRESS)

    @classmethod
    def closed_statuses(cls) -> tuple[TaskStatus, ...]:
        return (cls.DONE, cls.CANCELED)


class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class SessionStatus(str, Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class UpdateSource(str, Enum):
    PRE_MEETING = "pre_meeting"
    STANDUP = "standup"
    TASK_INTERFACE = "task_interface"
    AI_APPROVED = "ai_approved"
    SYSTEM = "system"


class AuditSource(str, Enum):
    EMPLOYEE_UPDATE = "employee_update"
    MANAGER_ACTION = "manager_action"
    TASK_INTERFACE = "task_interface"
    AI_APPROVED = "ai_approved"
    SYSTEM = "system"


class ActorType(str, Enum):
    USER = "user"
    SYSTEM = "system"


class BlockerStatus(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"


class ActionItemStatus(str, Enum):
    OPEN = "open"
    COMPLETED = "completed"
    CANCELED = "canceled"


class IntakeStatus(str, Enum):
    NEW = "new"
    UNDER_REVIEW = "under_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    CONVERTED = "converted"


class TranscriptStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"


class ProposalOperation(str, Enum):
    UPDATE_TASK_STATUS = "update_task_status"
    ASSIGN_TASK = "assign_task"
    ADD_PROGRESS_UPDATE = "add_progress_update"
    CREATE_BLOCKER = "create_blocker"
    RESOLVE_BLOCKER = "resolve_blocker"
    CREATE_ACTION_ITEM = "create_action_item"
    RECORD_DECISION = "record_decision"


class ProposalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    APPLIED = "applied"
    FAILED = "failed"


class TargetType(str, Enum):
    TASK = "task"
    PROJECT = "project"
    BLOCKER = "blocker"
    SESSION = "session"
