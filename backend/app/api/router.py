from fastapi import APIRouter

from app.api import ai, audit, daily_updates, intake, projects, standups, tasks, today, users

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(projects.router)
api_router.include_router(tasks.router)
api_router.include_router(standups.router)
api_router.include_router(intake.router)
api_router.include_router(audit.router)
api_router.include_router(ai.router)
api_router.include_router(today.router)
api_router.include_router(daily_updates.router)
