from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.enums import Role
from app.schemas.common import ORMModel


class UserOut(ORMModel):
    id: str
    email: str
    full_name: str
    role: Role
    is_active: bool
    standup_eligible: bool
    created_at: datetime


class MeOut(UserOut):
    is_manager: bool


class UserCreate(ORMModel):
    email: str = Field(min_length=3, max_length=320)
    full_name: str = Field(min_length=1, max_length=200)
    role: Role = Role.EMPLOYEE
    standup_eligible: bool = True


class UserPatch(ORMModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: Role | None = None
    is_active: bool | None = None
    standup_eligible: bool | None = None
