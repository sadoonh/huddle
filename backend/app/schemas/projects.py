from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.enums import ProjectMemberRole, ProjectStatus
from app.schemas.common import ORMModel, UserBrief


class ProjectCreate(ORMModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    owner_id: str | None = None
    status: ProjectStatus = ProjectStatus.ACTIVE
    member_ids: list[str] = Field(default_factory=list)


class ProjectPatch(ORMModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    owner_id: str | None = None
    status: ProjectStatus | None = None
    member_ids: list[str] | None = None


class ProjectOut(ORMModel):
    id: str
    name: str
    description: str | None
    status: ProjectStatus
    owner: UserBrief | None
    members: list[UserBrief] = Field(default_factory=list)
    task_counts: dict[str, int] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ProjectMemberOut(ORMModel):
    user: UserBrief
    role: ProjectMemberRole
