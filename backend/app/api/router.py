from fastapi import APIRouter

from app.api import audit, daily_updates, meta, projects, standups, tasks, today, users

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(projects.router)
api_router.include_router(tasks.router)
api_router.include_router(standups.router)
api_router.include_router(audit.router)
api_router.include_router(today.router)
api_router.include_router(daily_updates.router)
api_router.include_router(meta.router)
