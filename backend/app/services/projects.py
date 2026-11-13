from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError
from app.core.rbac import (
    ensure_project_editable,
    ensure_project_visible,
    get_project_or_404,
    get_user_or_404,
    is_manager,
    require_manager,
)
from app.enums import AuditSource, ProjectStatus
from app.models import Project, ProjectMember, Task, User
from app.schemas.common import UserBrief
from app.schemas.projects import ProjectCreate, ProjectOut, ProjectPatch
from app.services.audit import record_event, snapshot

_PROJECT_FIELDS = ("name", "description", "owner_id", "status")


def _counts_for_projects(db: Session, ids: list[str]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {pid: {} for pid in ids}
    if not ids:
        return result
    rows = db.execute(
        select(Task.project_id, Task.status, func.count(Task.id))
        .where(Task.project_id.in_(ids))
        .group_by(Task.project_id, Task.status)
    ).all()
    for project_id, status, count in rows:
        result[project_id][status.value] = count
    return result


def project_out(project: Project, counts: dict[str, int] | None = None) -> ProjectOut:
    # Built explicitly: the ORM ``members`` relationship holds ProjectMember
    # rows, while the API exposes users.
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        status=project.status,
        owner=UserBrief.model_validate(project.owner) if project.owner else None,
        members=[
            UserBrief.model_validate(member.user)
            for member in project.members
            if member.user
        ],
        task_counts=counts or {},
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def list_projects(
    db: Session, user: User, *, include_archived: bool = False
) -> list[ProjectOut]:
    stmt = select(Project).options(
        selectinload(Project.owner), selectinload(Project.members).selectinload(ProjectMember.user)
    )
    if not include_archived:
        stmt = stmt.where(Project.status != ProjectStatus.ARCHIVED)
    if not is_manager(user):
        stmt = (
            stmt.outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
            .where(or_(Project.owner_id == user.id, ProjectMember.user_id == user.id))
            .distinct()
        )
    projects = list(db.scalars(stmt.order_by(Project.name.asc())).unique().all())
    counts = _counts_for_projects(db, [p.id for p in projects])
    return [project_out(p, counts.get(p.id)) for p in projects]


def get_project(db: Session, user: User, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    ensure_project_visible(user, project)
    return project


def create_project(db: Session, user: User, payload: ProjectCreate) -> ProjectOut:
    require_manager(user)
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
    return project_out(project)


def patch_project(db: Session, user: User, project_id: str, payload: ProjectPatch) -> ProjectOut:
    project = get_project_or_404(db, project_id)
    ensure_project_editable(user, project)
    changes = payload.model_dump(exclude_unset=True)
    member_ids = changes.pop("member_ids", None)
    if changes.get("owner_id"):
        get_user_or_404(db, changes["owner_id"])

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
    counts = _counts_for_projects(db, [project.id]).get(project.id, {})
    return project_out(project, counts)


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
