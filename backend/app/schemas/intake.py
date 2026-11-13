from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from app.enums import IntakeStatus, Priority
from app.schemas.common import ORMModel, UserBrief


class IntakeCreate(ORMModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    priority: Priority = Priority.MEDIUM
    requester_name: str | None = None


class IntakePatch(ORMModel):
    status: IntakeStatus | None = None
    priority: Priority | None = None
    review_note: str | None = None


class IntakeConvertTask(ORMModel):
    project_id: str
    title: str | None = None
    description: str | None = None
    assignee_id: str | None = None
    priority: Priority | None = None
    due_date: date | None = None


class IntakeConvertProject(ORMModel):
    name: str | None = None
    description: str | None = None
    member_ids: list[str] = Field(default_factory=list)


class IntakeOut(ORMModel):
    id: str
    title: str
    description: str | None
    priority: Priority
    status: IntakeStatus
    requester: UserBrief | None
    requester_name: str | None
    reviewed_by: UserBrief | None
    review_note: str | None
    converted_task_id: str | None
    converted_project_id: str | None
    created_at: datetime
    updated_at: datetime
