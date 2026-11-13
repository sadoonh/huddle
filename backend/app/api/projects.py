from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DB, CurrentUser
from app.schemas.projects import ProjectCreate, ProjectOut, ProjectPatch
from app.services.projects import (
    create_project,
    get_project,
    list_projects,
    patch_project,
    project_out,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def projects(db: DB, user: CurrentUser, include_archived: bool = False):
    return list_projects(db, user, include_archived=include_archived)


@router.post("", response_model=ProjectOut, status_code=201)
def new_project(db: DB, user: CurrentUser, payload: ProjectCreate):
    return create_project(db, user, payload)


@router.get("/{project_id}", response_model=ProjectOut)
def project(db: DB, user: CurrentUser, project_id: str):
    return project_out(get_project(db, user, project_id))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(db: DB, user: CurrentUser, project_id: str, payload: ProjectPatch):
    return patch_project(db, user, project_id, payload)
