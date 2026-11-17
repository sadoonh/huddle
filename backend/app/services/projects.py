from __future__ import annotations

import logging

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import DomainValidationError, NotFoundError
from app.core.rbac import (
    can_edit_project,
    ensure_project_visible,
    get_project_or_404,
    get_user_or_404,
    is_manager,
    require_manager,
)
from app.enums import AuditSource, ProjectStatus, Role
from app.models import Project, ProjectMember, Task, User
from app.schemas.common import UserBrief
from app.schemas.projects import ProjectCreate, ProjectOut, ProjectPatch
from app.services.audit import record_event, snapshot

logger = logging.getLogger("standup.projects")

_PROJECT_FIELDS = ("name", "description", "owner_id", "status")

AD_HOC_SYSTEM_KEY = "ad_hoc"
AD_HOC_NAME = "Ad hoc"
AD_HOC_DESCRIPTION = "Unplanned work that does not belong to a named initiative."


def _counts_for_projects(
    db: Session, ids: list[str], user: User | None = None
) -> dict[str, dict[str, int]]:
    """Task counts, scoped to tasks the viewer is actually allowed to see."""
    result: dict[str, dict[str, int]] = {pid: {} for pid in ids}
    if not ids:
        return result
    stmt = select(Task.project_id, Task.status, func.count(Task.id)).where(
        Task.project_id.in_(ids)
    )
    if user is not None and not is_manager(user):
        stmt = stmt.where(
            or_(Task.assignee_id == user.id, Task.created_by_id == user.id)
        )
    rows = db.execute(stmt.group_by(Task.project_id, Task.status)).all()
    for project_id, status, count in rows:
        result[project_id][status.value] = count
    return result


def project_out(
    project: Project,
    counts: dict[str, int] | None = None,
    user: User | None = None,
) -> ProjectOut:
    # Built explicitly: the ORM ``members`` relationship holds ProjectMember
    # rows, while the API exposes users.
    return ProjectOut(
        id=project.id,
        public_id=project.public_id,
        name=project.name,
        description=project.description,
        status=project.status,
        system_key=project.system_key,
        owner=UserBrief.model_validate(project.owner) if project.owner else None,
        members=[
            UserBrief.model_validate(member.user)
            for member in project.members
            if member.user
        ],
        task_counts=counts or {},
        can_edit=can_edit_project(user, project) if user is not None else False,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _find_ad_hoc(db: Session) -> Project | None:
    return db.scalar(
        select(Project)
        .options(selectinload(Project.members))
        .where(Project.system_key == AD_HOC_SYSTEM_KEY)
    )


def _create_ad_hoc(db: Session) -> Project:
    candidates = list(
        db.scalars(
            select(Project)
            .options(selectinload(Project.members))
            .where(
                func.lower(Project.name) == AD_HOC_NAME.lower(),
                Project.system_key.is_(None),
            )
            .order_by(Project.created_at.asc())
        )
        .unique()
        .all()
    )
    if len(candidates) > 1:
        logger.warning(
            "Multiple projects are named %r; designating the oldest as Ad hoc. "
            "Resolve the duplicates deliberately, not silently.",
            AD_HOC_NAME,
        )
    if candidates:
        project = candidates[0]
        project.system_key = AD_HOC_SYSTEM_KEY
    else:
        owner = db.scalar(
            select(User)
            .where(User.is_active.is_(True), User.role.in_([Role.MANAGER, Role.ADMIN]))
            .order_by(User.created_at.asc())
        )
        project = Project(
            name=AD_HOC_NAME,
            description=AD_HOC_DESCRIPTION,
            system_key=AD_HOC_SYSTEM_KEY,
            owner_id=owner.id if owner else None,
            status=ProjectStatus.ACTIVE,
        )
        db.add(project)
    db.flush()
    return project


def _reconcile_ad_hoc_members(db: Session, project: Project) -> None:
    owner_is_employee = bool(
        project.owner_id
        and db.scalar(select(User.role).where(User.id == project.owner_id)) == Role.EMPLOYEE
    )
    if project.owner_id is None or owner_is_employee:
        owner = db.scalar(
            select(User)
            .where(User.is_active.is_(True), User.role.in_([Role.MANAGER, Role.ADMIN]))
            .order_by(User.created_at.asc())
        )
        project.owner_id = owner.id if owner else None
    existing_members = {member.user_id for member in project.members}
    active_users = db.scalars(select(User).where(User.is_active.is_(True))).all()
    for user in active_users:
        if user.id not in existing_members:
            project.members.append(
                ProjectMember(project_id=project.id, user_id=user.id)
            )
    db.flush()


def ensure_ad_hoc_project(db: Session) -> Project:
    """Idempotently provision the designated Ad hoc project.

    Concurrent page loads (and React strict-mode double effects) can call this
    at the same time. Project creation/adoption and member reconciliation use
    savepoints so a unique-constraint race cannot turn a read into a 409.
    """
    for _attempt in range(2):
        project = _find_ad_hoc(db)
        if project is None:
            try:
                with db.begin_nested():
                    project = _create_ad_hoc(db)
            except IntegrityError:
                db.expire_all()
                continue
        try:
            with db.begin_nested():
                _reconcile_ad_hoc_members(db, project)
        except IntegrityError:
            # Another request inserted the same membership; reload its row.
            db.expire_all()
            project = _find_ad_hoc(db)
        if project is not None:
            return project
    project = _find_ad_hoc(db)
    if project is None:  # pragma: no cover - defensive
        raise DomainValidationError("The Ad hoc project could not be provisioned.")
    return project


def list_projects(
    db: Session,
    user: User,
    *,
    include_archived: bool = False,
    q: str | None = None,
) -> list[ProjectOut]:
    ensure_ad_hoc_project(db)
    stmt = select(Project).options(
        selectinload(Project.owner),
        selectinload(Project.members).selectinload(ProjectMember.user),
    )
    if not include_archived:
        stmt = stmt.where(Project.status != ProjectStatus.ARCHIVED)
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Project.name.ilike(term), Project.public_id.ilike(term)))
    if not is_manager(user):
        stmt = (
            stmt.outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
            .where(or_(Project.owner_id == user.id, ProjectMember.user_id == user.id))
            .distinct()
        )
    projects = list(db.scalars(stmt.order_by(Project.name.asc())).unique().all())
    counts = _counts_for_projects(db, [p.id for p in projects], user)
    return [project_out(p, counts.get(p.id), user) for p in projects]


def get_project(db: Session, user: User, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    ensure_project_visible(user, project)
    return project


def get_project_out(db: Session, user: User, project_id: str) -> ProjectOut:
    project = get_project(db, user, project_id)
    counts = _counts_for_projects(db, [project.id], user).get(project.id, {})
    return project_out(project, counts, user)


def create_project(db: Session, user: User, payload: ProjectCreate) -> ProjectOut:
    require_manager(user)
    if payload.name.strip().lower() == AD_HOC_NAME.lower():
        raise DomainValidationError(
            "Ad hoc is provisioned automatically and cannot be created again."
        )
    if payload.owner_id:
        get_user_or_404(db, payload.owner_id)
    project = Project(
        name=payload.name.strip(),
        description=payload.description,
        owner_id=payload.owner_id or user.id,
        status=payload.status,
    )
    db.add(project)
    db.flush()
    _sync_members(db, project, payload.member_ids)
    record_event(
        db,
        event_type="project.created",
        entity_type="project",
        entity_id=project.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        new=snapshot(project, _PROJECT_FIELDS),
    )
    db.refresh(project)
    return project_out(project, {}, user)


def patch_project(db: Session, user: User, project_id: str, payload: ProjectPatch) -> ProjectOut:
    project = get_project_or_404(db, project_id)
    if not can_edit_project(user, project):
        from app.core.errors import ForbiddenError

        raise ForbiddenError("Only project owners and managers can edit this project")
    changes = payload.model_dump(exclude_unset=True)
    member_ids = changes.pop("member_ids", None)
    if changes.get("owner_id"):
        get_user_or_404(db, changes["owner_id"])

    if project.system_key == AD_HOC_SYSTEM_KEY:
        if changes.get("status") == ProjectStatus.ARCHIVED:
            raise DomainValidationError(
                "The designated Ad hoc project cannot be archived while it is the default."
            )
        if changes.get("owner_id"):
            new_owner = get_user_or_404(db, changes["owner_id"])
            if new_owner.role == Role.EMPLOYEE:
                raise DomainValidationError(
                    "The Ad hoc project needs a manager or admin owner."
                )

    previous = snapshot(project, _PROJECT_FIELDS)
    for field, value in changes.items():
        if field in ("name", "description") and isinstance(value, str):
            value = value.strip()
        setattr(project, field, value)
    if member_ids is not None:
        if not is_manager(user):
            from app.core.errors import ForbiddenError

            raise ForbiddenError("Only managers can change project membership")
        _sync_members(db, project, member_ids)
    db.flush()
    record_event(
        db,
        event_type="project.updated",
        entity_type="project",
        entity_id=project.id,
        actor=user,
        source=AuditSource.MANAGER_ACTION,
        previous=previous,
        new=snapshot(project, _PROJECT_FIELDS),
    )
    db.refresh(project)
    counts = _counts_for_projects(db, [project.id], user).get(project.id, {})
    return project_out(project, counts, user)


def _sync_members(db: Session, project: Project, member_ids: list[str]) -> None:
    wanted = set(member_ids)
    if project.owner_id:
        wanted.add(project.owner_id)
    existing = {member.user_id: member for member in project.members}
    for user_id in wanted:
        if user_id not in existing:
            get_user_or_404(db, user_id)
            project.members.append(ProjectMember(project_id=project.id, user_id=user_id))
    for user_id, member in existing.items():
        if user_id not in wanted:
            project.members.remove(member)
    db.flush()
