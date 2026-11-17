"""Application-level RBAC.

Rules (MVP):
* admin/manager: full read of the team workspace, manage projects/tasks, run
  standups, approve AI proposals.
* employee: read projects they belong to and tasks assigned to them or created
  by them; update their own tasks; submit their own pre-meeting note.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError
from app.enums import Role
from app.models import Project, StandupSession, Task, User


def is_manager(user: User) -> bool:
    return user.role in (Role.MANAGER, Role.ADMIN)


def require_manager(user: User) -> None:
    if not is_manager(user):
        raise ForbiddenError("Manager role required")


def require_admin(user: User) -> None:
    if user.role != Role.ADMIN:
        raise ForbiddenError("Admin role required")


def is_project_member(user: User, project: Project) -> bool:
    if user.role == Role.ADMIN:
        return True
    if project.owner_id == user.id:
        return True
    return any(member.user_id == user.id for member in project.members)


def ensure_project_visible(user: User, project: Project) -> None:
    if is_manager(user) or is_project_member(user, project):
        return
    raise ForbiddenError("You do not have access to this project")


def can_edit_project(user: User, project: Project) -> bool:
    return is_manager(user) or project.owner_id == user.id


def ensure_project_editable(user: User, project: Project) -> None:
    if can_edit_project(user, project):
        return
    raise ForbiddenError("Only project owners and managers can edit this project")


def ensure_task_visible(user: User, task: Task) -> None:
    if is_manager(user):
        return
    if task.assignee_id == user.id or task.created_by_id == user.id:
        return
    if task.project and task.project.owner_id == user.id:
        return
    raise ForbiddenError("You do not have access to this task")


def can_edit_task(user: User, task: Task) -> bool:
    """True when the user may change this task's fields and status.

    Mirrors ``ensure_task_editable`` so clients can disable actions instead of
    discovering a 403 after the fact.
    """
    if is_manager(user):
        return True
    return task.assignee_id == user.id or task.created_by_id == user.id


def ensure_task_editable(user: User, task: Task) -> None:
    if can_edit_task(user, task):
        return
    raise ForbiddenError("You can only edit tasks assigned to you or created by you")


def ensure_session_visible(user: User, session: StandupSession) -> None:
    if is_manager(user):
        return
    if any(participant.user_id == user.id for participant in session.participants):
        return
    raise ForbiddenError("You are not a participant in this standup")


def ensure_can_facilitate(user: User, session: StandupSession) -> None:
    require_manager(user)


def get_project_or_404(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    return project


def get_task_or_404(db: Session, task_id: str) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise NotFoundError("Task not found")
    return task


def get_user_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    return user
