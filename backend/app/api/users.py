from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.config import get_settings
from app.core.errors import ConflictError
from app.core.rbac import require_admin
from app.enums import AuditSource
from app.models import User
from app.schemas.users import MeOut, UserCreate, UserOut, UserPatch
from app.services.audit import record_event

router = APIRouter(tags=["users"])


@router.get("/auth/config")
def auth_config():
    settings = get_settings()
    return {"mode": settings.auth_mode}


@router.get("/auth/dev-users", response_model=list[UserOut])
def dev_users(db: DB):
    """Development-only identity picker. Never available outside dev mode."""
    settings = get_settings()
    if settings.auth_mode != "dev" or settings.environment not in {
        "local",
        "dev",
        "development",
        "test",
        "ci",
    }:
        raise HTTPException(status_code=404, detail="Not found")
    return list(
        db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.full_name)).all()
    )


@router.get("/me", response_model=MeOut)
def me(user: CurrentUser):
    out = MeOut.model_validate(user)
    out.is_manager = user.is_manager
    return out


@router.get("/users", response_model=list[UserOut])
def list_users(db: DB, user: CurrentUser, include_inactive: bool = False):
    stmt = select(User).order_by(User.full_name.asc())
    if not include_inactive:
        stmt = stmt.where(User.is_active.is_(True))
    return list(db.scalars(stmt).all())


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(db: DB, user: CurrentUser, payload: UserCreate):
    require_admin(user)
    email = payload.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise ConflictError("A user with this e-mail already exists")
    created = User(
        email=email,
        full_name=payload.full_name.strip(),
        role=payload.role,
        standup_eligible=payload.standup_eligible,
    )
    db.add(created)
    db.flush()
    record_event(
        db,
        event_type="user.created",
        entity_type="user",
        entity_id=created.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        new={"email": created.email, "role": created.role.value},
    )
    return created


@router.patch("/users/{user_id}", response_model=UserOut)
def patch_user(db: DB, user: CurrentUser, user_id: str, payload: UserPatch):
    require_admin(user)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return target
    previous = {field: getattr(target, field) for field in changes}
    for field, value in changes.items():
        if field == "full_name" and isinstance(value, str):
            value = value.strip()
        setattr(target, field, value)
    db.flush()
    record_event(
        db,
        event_type="user.updated",
        entity_type="user",
        entity_id=target.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        previous={k: str(v) for k, v in previous.items()},
        new={k: str(v) for k, v in changes.items()},
    )
    return target
