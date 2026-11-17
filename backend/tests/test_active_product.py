from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.dev_schema import upgrade_database
from app.models import Project, Task

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _create_task(client: TestClient, team, **extra) -> dict:
    payload = {"project_id": team.project.id, "title": "Task", **extra}
    response = client.post("/api/v1/tasks", headers=team.auth("manager"), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Task list: free-text blocked filter, date-free ordering
# ---------------------------------------------------------------------------
def test_list_order_ignores_due_dates_and_legacy_blockers(client: TestClient, team, db: Session):
    first = _create_task(
        client, team, title="Due long ago", status="todo", due_date=str(date.today() - timedelta(days=30))
    )
    second = _create_task(
        client, team, title="Undated and newer", status="todo", due_date=None
    )
    # ``second`` was inserted later, so -updated puts it first even though
    # ``first`` is overdue by 30 days.
    default = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"limit": 200}
    ).json()["items"]
    ids = [item["id"] for item in default]
    assert ids.index(second["id"]) < ids.index(first["id"])

    by_due = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"sort": "due", "limit": 200}
    ).json()["items"]
    assert [item["id"] for item in by_due] == ids

    overdue = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"overdue": True, "limit": 200},
    ).json()["items"]
    assert {item["id"] for item in overdue} == set(ids)

    # Legacy blocker rows never set the active flag; free text does.
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert detail["is_blocked"] is False
    assert detail["open_blocker_count"] == 0
    assert detail["is_overdue"] is False

    blocked = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}",
        headers=team.auth("manager"),
        json={"blocked_by": "Waiting on access"},
    )
    assert blocked.status_code == 200
    assert blocked.json()["is_blocked"] is True

    only_blocked = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"blocked": True, "limit": 200},
    ).json()["items"]
    assert [item["id"] for item in only_blocked] == [team.dashboard.id]

    cleared = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}",
        headers=team.auth("manager"),
        json={"blocked_by": "   "},
    ).json()
    assert cleared["is_blocked"] is False
    assert (
        client.get(
            "/api/v1/tasks",
            headers=team.auth("manager"),
            params={"blocked": True, "limit": 200},
        ).json()["items"]
        == []
    )
    # Even with an open legacy blocker, the blocked filter is empty again.
    assert team.open_blocker.status.value == "open"


# ---------------------------------------------------------------------------
# Today: relevance/order from status + free text only
# ---------------------------------------------------------------------------
def test_today_relevance_ignores_due_help_followups_and_legacy_rows(client: TestClient, team):
    todo = _create_task(
        client, team, title="Open todo", status="todo", due_date=str(date.today() + timedelta(days=400))
    )
    in_progress = _create_task(client, team, title="Open progress", status="in_progress")
    backlog = _create_task(
        client,
        team,
        title="Backlog with a huge due date",
        status="backlog",
        due_date=str(date.today() - timedelta(days=90)),
    )
    canceled = _create_task(client, team, title="Canceled work", status="canceled")

    # Legacy helper rows on a backlog task must not make it relevant.
    blocker = client.post(
        f"/api/v1/tasks/{backlog['id']}/blockers",
        headers=team.auth("manager"),
        json={"description": "Legacy help on backlog"},
    )
    assert blocker.status_code == 201
    action = client.post(
        "/api/v1/action-items",
        headers=team.auth("manager"),
        json={"description": "Legacy follow-up", "task_id": backlog["id"]},
    )
    assert action.status_code == 201

    body = client.get("/api/v1/today", headers=team.auth("manager")).json()
    ids = [item["id"] for item in body["checkin"]["items"]]
    assert todo["id"] in ids
    assert in_progress["id"] in ids
    assert backlog["id"] not in ids
    assert canceled["id"] not in ids
    assert body["other_commitments"] == []
    assert all(
        not ({"overdue", "blocker", "follow_up", "help", "due_soon"} & set(item["reasons"]))
        for item in body["checkin"]["items"]
    )

    # A blocked non-closed backlog task becomes relevant, independent of dates.
    paused = _create_task(client, team, title="Paused and blocked", status="backlog")
    client.patch(
        f"/api/v1/tasks/{paused['id']}",
        headers=team.auth("manager"),
        json={"blocked_by": "Vendor contract"},
    )
    refreshed = client.get("/api/v1/today", headers=team.auth("manager")).json()
    rows = {item["id"]: item for item in refreshed["checkin"]["items"]}
    assert paused["id"] in rows
    assert rows[paused["id"]]["reasons"] == ["blocked"]

    # Blocked text sorts first, then most recently touched.
    assert refreshed["checkin"]["items"][0]["id"] == paused["id"]

    # Title OR public_id search.
    by_public_id = client.get(
        "/api/v1/today",
        headers=team.auth("manager"),
        params={"q": todo["public_id"]},
    ).json()
    assert [item["id"] for item in by_public_id["checkin"]["items"]] == [todo["id"]]


# ---------------------------------------------------------------------------
# Live workspace: date-free, free-text attention, no carry-forward
# ---------------------------------------------------------------------------
def test_workspace_is_free_text_and_date_free(client: TestClient, team, today_session):
    def workspace() -> dict:
        response = client.get(
            f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}/workspace",
            headers=team.auth("manager"),
        )
        assert response.status_code == 200, response.text
        return response.json()

    body = workspace()
    assert body["needs_attention"] == []
    assert body["carried_blockers"] == []
    assert body["carried_action_items"] == []
    active_titles = [item["title"] for item in body["active"]]
    # Todo sorts before in-progress, then -updated; no due dates involved.
    assert active_titles[0] == "Overdue reconciliation"
    assert {
        "Overdue reconciliation",
        "Alpha dashboard",
        "At risk model",
    } <= set(active_titles)
    assert "Finished task" in {item["title"] for item in body["other"]}

    client.patch(
        f"/api/v1/tasks/{team.at_risk.id}",
        headers=team.auth("manager"),
        json={"blocked_by": "Model access"},
    )
    refreshed = workspace()
    assert [item["title"] for item in refreshed["needs_attention"]] == ["At risk model"]
    assert refreshed["needs_attention"][0]["reasons"] == ["blocked"]
    assert refreshed["needs_attention"][0]["open_blockers"] == []


# ---------------------------------------------------------------------------
# Session outcomes: new active arrays, legacy arrays empty, permission scoped
# ---------------------------------------------------------------------------
def test_blocked_by_belongs_to_the_task_not_the_update(client: TestClient, team):
    task_id = team.overdue.id
    client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=team.auth("manager"),
        json={"blocked_by": "Current text"},
    )
    update = client.post(
        f"/api/v1/tasks/{task_id}/updates",
        headers=team.auth("manager"),
        json={"progress": "No mention", "blocked_by": "should be ignored"},
    ).json()
    assert "blocked_by" not in update
    assert update["task_public_id"] == team.overdue.public_id
    task = client.get(f"/api/v1/tasks/{task_id}", headers=team.auth("manager")).json()
    assert task["blocked_by"] == "Current text"

    cleared = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=team.auth("manager"),
        json={"blocked_by": None},
    ).json()
    assert cleared["blocked_by"] is None


# ---------------------------------------------------------------------------
# dev_schema: safe local upgrade of a populated legacy SQLite database
# ---------------------------------------------------------------------------
def test_dev_schema_upgrades_populated_database_without_reset(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config

    import app.config as config_module

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    # Build the pre-public_id schema directly; the dev_schema path is what we
    # are testing, so do not run the Alembic upgrade to head here.
    monkeypatch.setattr(
        config_module, "get_settings", lambda: Settings(database_url=url)
    )
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
                "('t1','p1','First','medium','in_progress',0,1,'2026-01-01','2026-01-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO blockers (id,task_id,description,status,created_at,updated_at) "
                "VALUES ('b1','t1','warehouse access','open',"
                "'2026-01-05','2026-01-05')"
            )
        )

    settings = Settings(database_url=url)
    added = upgrade_database(engine, settings)
    assert "tasks.public_id" in added
    assert "projects.public_id" in added

    with engine.connect() as connection:
        ids = dict(connection.execute(text("SELECT id, public_id FROM tasks")).all())
        assert ids == {"t1": "TASK-1", "t2": "TASK-2"}
        projects = dict(connection.execute(text("SELECT id, public_id FROM projects")).all())
        assert projects == {"p1": "PROJ-1", "p2": "PROJ-2"}
        assert connection.execute(
            text("SELECT blocked_by FROM tasks WHERE id = 't1'")
        ).scalar_one() == "warehouse access"
        counters = dict(
            connection.execute(
                text("SELECT kind, last_value FROM public_id_sequences")
            ).all()
        )
        assert counters == {"task": 2, "project": 2}
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "d4a1b2c3e5f6"
        indexes = {index["name"] for index in inspect(engine).get_indexes("tasks")}
        assert "ix_tasks_public_id" in indexes

    # A curated blocked-by value survives repeat startups; ids are stable.
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE tasks SET blocked_by = 'Curated text' WHERE id = 't1'")
        )
        connection.execute(
            text(
                "INSERT INTO blockers (id,task_id,description,status,created_at,updated_at) "
                "VALUES ('b2','t1','new legacy open','open','2026-01-06','2026-01-06')"
            )
        )
    assert upgrade_database(engine, settings) == []

    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT blocked_by FROM tasks WHERE id = 't1'")
        ).scalar_one() == "Curated text"
        assert dict(connection.execute(text("SELECT id, public_id FROM tasks")).all()) == ids
        counters = dict(
            connection.execute(
                text("SELECT kind, last_value FROM public_id_sequences")
            ).all()
        )
        assert counters == {"task": 2, "project": 2}

    # New ORM records continue after the migrated high-water mark.
    session = sessionmaker(bind=engine)()
    try:
        project = Project(name="Post local upgrade")
        session.add(project)
        session.flush()
        assert project.public_id == "PROJ-3"
        task = Task(project_id=project.id, title="New after upgrade")
        session.add(task)
        session.flush()
        assert task.public_id == "TASK-3"
    finally:
        session.close()
