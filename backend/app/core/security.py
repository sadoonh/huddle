"""Authentication.

Two modes:

``nex`` (production)
    The nex portal terminates SSO and injects the authenticated identity as
    headers. The API *trusts these headers*; therefore the portal gateway must
    strip client-supplied copies before proxying. Users are provisioned on
    first sight as employees; managers/admins are promoted from the
    ``X-Nex-Roles`` header but never silently demoted.

``dev`` (local development and tests)
    ``X-Dev-User`` selects an identity (e-mail or user id) so a developer can
    switch between the manager and an employee without an SSO round-trip. This
    mode refuses to run unless the environment is local/dev/test.
"""

from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import ForbiddenError, UnauthorizedError
from app.db import get_db
from app.enums import AuditSource, Role
from app.models import User

_DEV_ENVIRONMENTS = {"local", "dev", "development", "test", "ci"}


def _role_from_headers(raw: str | None) -> Role:
    values = {part.strip().lower() for part in (raw or "").split(",") if part.strip()}
    if "admin" in values or "nex-admin" in values:
        return Role.ADMIN
    if "manager" in values or "nex-manager" in values:
        return Role.MANAGER
    return Role.EMPLOYEE


def _authenticate_nex(request: Request, db: Session) -> User:
    settings = get_settings()
    external_id = request.headers.get(settings.nex_user_header)
    email = request.headers.get(settings.nex_email_header)
    if not external_id or not email:
        raise UnauthorizedError("Missing nex identity headers")

    email = email.strip().lower()
    user = db.scalar(
        select(User).where(or_(User.external_id == external_id, User.email == email))
    )
    header_role = _role_from_headers(request.headers.get(settings.nex_roles_header))
    full_name = request.headers.get(settings.nex_name_header) or email.split("@")[0]

    if user is None:
        user = User(
            external_id=external_id,
            email=email,
            full_name=full_name,
            role=header_role,
        )
        db.add(user)
        db.flush()
        _audit_provisioned(db, user)
        return user

    changed = False
    if user.external_id != external_id:
        user.external_id = external_id
        changed = True
    if not user.is_active:
        raise ForbiddenError("User is inactive")
    # Only ever elevate from the SSO header; de-provisioning is a manual admin act.
    if header_role == Role.ADMIN and user.role != Role.ADMIN:
        user.role = Role.ADMIN
        changed = True
    elif header_role == Role.MANAGER and user.role == Role.EMPLOYEE:
        user.role = Role.MANAGER
        changed = True
    if changed:
        db.flush()
    return user


def _authenticate_dev(request: Request, db: Session) -> User:
    settings = get_settings()
    if settings.environment not in _DEV_ENVIRONMENTS:
        raise UnauthorizedError(
            "auth_mode=dev is only allowed in local/dev/test environments"
        )

    identity = (request.headers.get("X-Dev-User") or settings.dev_default_user_email).strip()
    user = db.scalar(
        select(User).where(or_(User.email == identity.lower(), User.id == identity))
    )
    if user is None:
        if identity.lower() != settings.dev_default_user_email.lower():
            raise UnauthorizedError(f"Unknown dev user: {identity}")
        # First run: provision the default manager so the app is usable
        # immediately after `python -m app.seed`.
        user = User(
            email=identity.lower(),
            full_name="Default Manager",
            role=Role.MANAGER,
        )
        db.add(user)
        db.flush()
        _audit_provisioned(db, user)

    if not user.is_active:
        raise ForbiddenError("User is inactive")
    return user


def _audit_provisioned(db: Session, user: User) -> None:
    from app.services.audit import record_event  # local import to avoid a cycle

    record_event(
        db,
        event_type="user.provisioned",
        entity_type="user",
        entity_id=user.id,
        actor=None,
        actor_type="system",
        actor_label="nex-sso",
        source=AuditSource.SYSTEM,
        new={"email": user.email, "role": user.role.value},
    )


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    settings = get_settings()
    if settings.auth_mode == "nex":
        return _authenticate_nex(request, db)
    if settings.auth_mode == "dev":
        return _authenticate_dev(request, db)
    raise UnauthorizedError(f"Unsupported auth_mode: {settings.auth_mode}")
