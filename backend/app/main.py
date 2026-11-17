from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.router import api_router
from app.config import get_settings
from app.core.errors import AppError
from app.db import engine, init_db

logger = logging.getLogger("huddle")
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # SQLite is used for local dev/tests only. Postgres deployments run Alembic
    # (see migrations/) unless AUTO_INIT_DB is explicitly enabled.
    if settings.is_sqlite or settings.auto_init_db:
        init_db()

    # Provision the designated Ad hoc project for fresh and existing databases
    # (production runs migrations before the app starts). Reads also reconcile
    # new users lazily, so a startup failure here is recoverable.
    from app.db import SessionLocal  # noqa: PLC0415
    from app.services.projects import ensure_ad_hoc_project  # noqa: PLC0415

    db = SessionLocal()
    try:
        ensure_ad_hoc_project(db)
        db.commit()
    except Exception:  # pragma: no cover - startup should not fail on this
        db.rollback()
        logger.exception("Could not provision the Ad hoc project")
    finally:
        db.close()
    yield


app = FastAPI(
    title="nex Huddle",
    description="Huddle-first project and task management API.",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "code": exc.code, "details": exc.details},
    )


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_request: Request, exc: IntegrityError) -> JSONResponse:
    logger.warning("Integrity error: %s", exc)
    return JSONResponse(
        status_code=409,
        content={
            "detail": "The request conflicts with existing data.",
            "code": "conflict",
            "details": {},
        },
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(_request: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger.exception("Database error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "A database error occurred.", "code": "database_error", "details": {}},
    )


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok", "service": "nex-huddle", "environment": settings.environment}


@app.get("/health/ready", tags=["health"])
def readiness() -> dict:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ready"}


app.include_router(api_router, prefix=settings.api_prefix)
