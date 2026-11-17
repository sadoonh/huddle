from __future__ import annotations

import importlib.util
import re
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import Settings
from app.enums import Priority, TaskStatus
from app.models import Project, Task, User
from app.services.projects import ensure_ad_hoc_project

BACKEND_ROOT = Path(__file__).resolve().parents[1]
TASK_ID_RE = re.compile(r"^TASK-\d+$")
PROJECT_ID_RE = re.compile(r"^PROJ-\d+$")


def _num(public_id: str) -> int:
    return int(public_id.split("-", 1)[1])


# ---------------------------------------------------------------------------
# Public ids
# ---------------------------------------------------------------------------
def test_orm_fixtures_get_unique_public_ids(client: TestClient, team, db: Session):
    assert PROJECT_ID_RE.match(team.project.public_id)
    task_ids = [
        team.dashboard.public_id,
        team.overdue.public_id,
        team.at_risk.public_id,
        team.backlog.public_id,
        team.done.public_id,
        team.bob_task.public_id,
    ]
    assert all(TASK_ID_RE.match(public_id) for public_id in task_ids)
    assert len(set(task_ids)) == len(task_ids)

    # A plain ORM fixture (not the HTTP service) is allocated on flush too.
    extra = Task(
        project_id=team.project.id,
        title="Raw ORM task",
        assignee_id=team.alice.id,
        priority=Priority.LOW,
        status=TaskStatus.TODO,
    )
    db.add(extra)
    db.flush()
    assert TASK_ID_RE.match(extra.public_id)
    assert extra.public_id not in task_ids

    listed = client.get("/api/v1/tasks", headers=team.auth("manager")).json()
    assert all(TASK_ID_RE.match(item["public_id"]) for item in listed["items"])
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert detail["public_id"] == team.dashboard.public_id
    assert PROJECT_ID_RE.match(
        client.get(f"/api/v1/projects/{team.project.id}", headers=team.auth("manager")).json()[
            "public_id"
        ]
    )


def test_created_records_continue_the_sequence_and_ids_are_immutable(
    client: TestClient, team
):
    highest = _num(team.bob_task.public_id)
    created = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={"project_id": team.project.id, "title": "Next in sequence"},
    )
    assert created.status_code == 201, created.text
    task = created.json()
    assert TASK_ID_RE.match(task["public_id"])
    assert _num(task["public_id"]) > highest

    project = client.post(
        "/api/v1/projects",
        headers=team.auth("manager"),
        json={"name": "New initiative", "member_ids": [team.alice.id]},
    )
    assert project.status_code == 201, project.text
    assert PROJECT_ID_RE.match(project.json()["public_id"])

    patched = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"title": "Renamed", "blocked_by": "waiting on access"},
    )
    assert patched.status_code == 200
    assert patched.json()["public_id"] == task["public_id"]


def test_public_id_is_searchable_and_ad_hoc_is_stable(client: TestClient, team):
    target = team.overdue.public_id
    found = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"q": target}
    ).json()
    assert {item["id"] for item in found["items"]} == {team.overdue.id}

    lower = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"q": target.lower()}
    ).json()
    assert {item["id"] for item in lower["items"]} == {team.overdue.id}

    projects = client.get(
        "/api/v1/projects",
        headers=team.auth("manager"),
        params={"q": "PROJ-"},
    ).json()
    assert projects and all(PROJECT_ID_RE.match(p["public_id"]) for p in projects)

    from app.db import SessionLocal

    db = SessionLocal()
    try:
        first = ensure_ad_hoc_project(db).public_id
        db.commit()
        second = ensure_ad_hoc_project(db).public_id
        assert first == second
        assert PROJECT_ID_RE.match(first)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# blocked_by on tasks
# ---------------------------------------------------------------------------
def test_blocked_by_create_patch_clear_and_audit(client: TestClient, team):
    created = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "title": "Needs access",
            "blocked_by": "   waiting on warehouse credentials  ",
        },
    )
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["blocked_by"] == "waiting on warehouse credentials"

    blank = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={"project_id": team.project.id, "title": "Blank", "blocked_by": "   "},
    ).json()
    assert blank["blocked_by"] is None

    untouched = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"title": "Renamed only"},
    ).json()
    assert untouched["blocked_by"] == "waiting on warehouse credentials"
    assert untouched["version"] == 2

    trimmed = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"blocked_by": "  data backfill  "},
    ).json()
    assert trimmed["blocked_by"] == "data backfill"
    assert trimmed["version"] == 3

    cleared = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"blocked_by": "   "},
    )
    assert cleared.status_code == 200
    assert cleared.json()["blocked_by"] is None
    assert cleared.json()["version"] == 4

    client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"blocked_by": "only until friday"},
    )
    explicit_null = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"blocked_by": None},
    ).json()
    assert explicit_null["blocked_by"] is None

    audit = client.get(
        "/api/v1/audit",
        headers=team.auth("manager"),
        params={"entity_type": "task", "entity_id": task["id"]},
    ).json()
    updated = [event for event in audit["items"] if event["event_type"] == "task.updated"]
    assert any(event["new_values"].get("blocked_by") == "data backfill" for event in updated)
    assert any(
        event["previous_values"].get("blocked_by") == "data backfill"
        and event["new_values"].get("blocked_by") is None
        for event in updated
    )


def test_blocked_by_role_checks(client: TestClient, team):
    own = client.patch(
        f"/api/v1/tasks/{team.overdue.id}",
        headers=team.auth("alice"),
        json={"blocked_by": "waiting on my access"},
    )
    assert own.status_code == 200
    assert own.json()["blocked_by"] == "waiting on my access"

    other = client.patch(
        f"/api/v1/tasks/{team.bob_task.id}",
        headers=team.auth("alice"),
        json={"blocked_by": "not mine"},
    )
    assert other.status_code == 403

    other_update = client.post(
        f"/api/v1/tasks/{team.bob_task.id}/updates",
        headers=team.auth("alice"),
        json={"progress": "sneaky", "blocked_by": "not mine"},
    )
    assert other_update.status_code == 403

    manager = client.patch(
        f"/api/v1/tasks/{team.bob_task.id}",
        headers=team.auth("manager"),
        json={"blocked_by": "manager note"},
    )
    assert manager.status_code == 200
    assert manager.json()["blocked_by"] == "manager note"


# ---------------------------------------------------------------------------
# blocked_by through progress updates (atomic with version/audit)
# ---------------------------------------------------------------------------
def _load_migration_module():
    path = BACKEND_ROOT / "migrations/versions/c3f8a1d2e4b5_add_public_ids_and_blocked_by.py"
    spec = importlib.util.spec_from_file_location("migration_public_ids", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_migration_backfills_ids_and_open_blocker_text(monkeypatch, tmp_path):
    from alembic import command
    from alembic.config import Config

    import app.config as config_module

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    monkeypatch.setattr(
        config_module, "get_settings", lambda: Settings(database_url=url)
    )
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    command.upgrade(cfg, "a1b2c3d4e5f6")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id,email,full_name,role,is_active,standup_eligible,"
                "created_at,updated_at) VALUES "
                "('u1','m@example.com','Manager','manager',1,0,"
                "'2026-01-01 00:00:00','2026-01-01 00:00:00')"
            )
        )
        # Inserted out of order to prove the backfill sorts by created_at, id.
        connection.execute(
            text(
                "INSERT INTO projects (id,name,status,created_at,updated_at) VALUES "
                "('p2','Later','active','2026-01-02','2026-01-02'),"
                "('p1','Earlier','active','2026-01-01','2026-01-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO tasks (id,project_id,title,priority,status,is_at_risk,version,"
                "created_at,updated_at) VALUES "
                "('t2','p1','Second','medium','todo',0,1,'2026-01-02','2026-01-02'),"
                "('t1','p1','First','medium','in_progress',0,1,'2026-01-01','2026-01-01'),"
                "('t3','p1','Third','medium','todo',0,1,'2026-01-03','2026-01-03')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO blockers (id,task_id,description,status,created_at,updated_at) "
                "VALUES "
                "('b1','t1','old open','open','2026-01-05','2026-01-05'),"
                "('b2','t1','old resolved','resolved','2026-01-05','2026-01-05'),"
                "('b3','t3','first open','open','2026-01-05','2026-01-05'),"
                "('b4','t3','second open','open','2026-01-06','2026-01-06'),"
                "('b5','t2','resolved only','resolved','2026-01-06','2026-01-06')"
            )
        )

    command.upgrade(cfg, "head")

    with engine.connect() as connection:
        projects = dict(
            connection.execute(text("SELECT id, public_id FROM projects")).all()
        )
        tasks = dict(connection.execute(text("SELECT id, public_id FROM tasks")).all())
        blocked = dict(
            connection.execute(text("SELECT id, blocked_by FROM tasks")).all()
        )
        sequences = dict(
            connection.execute(
                text("SELECT kind, last_value FROM public_id_sequences")
            ).all()
        )
        blocker_count = connection.execute(
            text("SELECT COUNT(*) FROM blockers")
        ).scalar_one()

        # Deterministic numbering by (created_at, id), not insertion order.
        assert projects == {"p1": "PROJ-1", "p2": "PROJ-2"}
        assert tasks == {"t1": "TASK-1", "t2": "TASK-2", "t3": "TASK-3"}
        assert sequences == {"task": 3, "project": 2}

        # Open task-linked blockers become free text; resolved ones do not.
        assert blocked["t1"] == "old open"
        assert blocked["t2"] is None
        assert blocked["t3"] == "first open; second open"
        # Legacy rows are preserved untouched.
        assert blocker_count == 5

        # The check constraint that users must not lose: ids are unique.
        assert connection.execute(
            text("SELECT COUNT(DISTINCT public_id) FROM tasks")
        ).scalar_one() == 3

    # Existing text wins when the migration helper is re-applied (idempotency).
    migration = _load_migration_module()
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE tasks SET blocked_by = 'Manually curated' WHERE id = 't3'")
        )
        migration._migrate_open_blocker_descriptions(connection)
        preserved = connection.execute(
            text("SELECT blocked_by FROM tasks WHERE id = 't3'")
        ).scalar_one()
        assert preserved == "Manually curated"

    # New ORM writes continue after the migrated high-water mark.
    from sqlalchemy.orm import sessionmaker

    session = sessionmaker(bind=engine)()
    try:
        project = Project(name="Post migration", owner_id=None)
        session.add(project)
        session.flush()
        assert PROJECT_ID_RE.match(project.public_id)
        assert _num(project.public_id) == 3

        user = User(email="u2@example.com", full_name="Other")
        session.add(user)
        session.flush()
        task = Task(project_id=project.id, title="After migration", created_by_id=user.id)
        session.add(task)
        session.flush()
        assert TASK_ID_RE.match(task.public_id)
        assert _num(task.public_id) == 4
    finally:
        session.close()
