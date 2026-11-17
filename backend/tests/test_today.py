from __future__ import annotations

from fastapi.testclient import TestClient

from app.models import utcnow


def test_employee_checkin_is_deduplicated_and_keeps_taskless_items(
    client: TestClient, team, previous_standup
):
    blocker = client.post(
        "/api/v1/blockers",
        headers=team.auth("alice"),
        json={"description": "Need design input on the empty state"},
    )
    assert blocker.status_code == 201, blocker.text
    assert blocker.json()["task_id"] is None

    action = client.post(
        "/api/v1/action-items",
        headers=team.auth("manager"),
        json={"description": "Alice to send the reconciliation notes", "owner_id": team.alice.id},
    )
    assert action.status_code == 201

    today = client.get("/api/v1/today", headers=team.auth("alice"))
    assert today.status_code == 200, today.text
    body = today.json()

    dashboard_rows = [
        item for item in body["checkin"]["items"] if item["id"] == team.dashboard.id
    ]
    assert len(dashboard_rows) == 1
    # Legacy blockers/actions are stored but no longer drive active attention.
    assert dashboard_rows[0]["reasons"] == []
    assert dashboard_rows[0]["open_blockers"] == []
    assert dashboard_rows[0]["open_action_items"] == []
    assert dashboard_rows[0]["is_blocked"] is False

    # Taskless commitments no longer appear in the active check-in projection.
    assert body["other_commitments"] == []

    checkin_ids = {task["id"] for task in body["checkin"]["items"]}
    assert team.dashboard.id in checkin_ids
    assert team.overdue.id in checkin_ids
    assert team.backlog.id not in checkin_ids
    assert team.done.id not in checkin_ids

    # Free text controls attention regardless of due dates or legacy rows.
    blocked = client.patch(
        f"/api/v1/tasks/{team.overdue.id}",
        headers=team.auth("manager"),
        json={"blocked_by": "Waiting on finance"},
    )
    assert blocked.status_code == 200
    refreshed = client.get("/api/v1/today", headers=team.auth("alice")).json()
    overdue_row = next(
        item for item in refreshed["checkin"]["items"] if item["id"] == team.overdue.id
    )
    assert overdue_row["reasons"] == ["blocked"]
    assert overdue_row["is_blocked"] is True
    assert refreshed["checkin"]["items"][0]["id"] == team.overdue.id


def test_checkin_paginates_the_full_relevant_set(client: TestClient, team):
    full = client.get("/api/v1/today", headers=team.auth("manager")).json()
    total = full["checkin"]["total"]
    assert total >= 3

    page = client.get(
        "/api/v1/today",
        headers=team.auth("manager"),
        params={"limit": 2, "offset": 1},
    ).json()
    assert page["checkin"]["total"] == total
    assert len(page["checkin"]["items"]) == 2
    assert page["checkin"]["offset"] == 1


def test_manager_checkin_includes_team_tasks_and_respects_owner_filter(
    client: TestClient, team
):
    body = client.get("/api/v1/today", headers=team.auth("manager")).json()
    titles = {item["title"] for item in body["checkin"]["items"]}
    assert "Alpha dashboard" in titles
    assert "Overdue reconciliation" in titles
    assert "Bob task" in titles
    assert "Backlog idea" not in titles
    assert body["cutoff_label"] == "Since the start of today"

    bob_only = client.get(
        "/api/v1/today",
        headers=team.auth("manager"),
        params={"assignee_id": team.bob.id},
    ).json()
    assert {item["title"] for item in bob_only["checkin"]["items"]} == {"Bob task"}


def test_recently_completed_uses_the_previous_standup_boundary(
    client: TestClient, team, previous_standup, db
):
    team.done.completed_at = utcnow()
    db.commit()

    body = client.get("/api/v1/today", headers=team.auth("manager")).json()
    recent_ids = {task["id"] for task in body["recently_completed"]["items"]}
    assert team.done.id in recent_ids
    assert body["recently_completed"]["total"] >= 1
    assert "standup" in body["cutoff_label"].lower()


def test_today_reports_the_state_aware_standup_session(client: TestClient, team):
    assert client.get("/api/v1/today", headers=team.auth("manager")).json()["session"] is None

    created = client.post(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        json={"participant_ids": [team.alice.id, team.bob.id]},
    )
    assert created.status_code == 201

    manager_body = client.get("/api/v1/today", headers=team.auth("manager")).json()
    assert manager_body["session"]["status"] == "draft"
    assert manager_body["session"]["participant_count"] == 2

    employee_body = client.get("/api/v1/today", headers=team.auth("alice")).json()
    assert employee_body["session"]["id"] == created.json()["id"]


def test_daily_update_is_optional_upserted_and_visible_in_the_workspace(
    client: TestClient, team
):
    assert client.get("/api/v1/daily-updates/today", headers=team.auth("alice")).json() is None

    first = client.put(
        "/api/v1/daily-updates/today",
        headers=team.auth("alice"),
        json={"progress": "Dashboard validation is complete."},
    )
    assert first.status_code == 200
    assert first.json()["progress"] == "Dashboard validation is complete."

    second = client.put(
        "/api/v1/daily-updates/today",
        headers=team.auth("alice"),
        json={
            "progress": "Dashboard validation is complete; finance signed off.",
            "next_steps": "Publish tomorrow.",
        },
    )
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["next_steps"] == "Publish tomorrow."

    session = client.post(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        json={"participant_ids": [team.alice.id]},
    ).json()
    workspace = client.get(
        f"/api/v1/standups/sessions/{session['id']}/participants/{team.alice.id}/workspace",
        headers=team.auth("manager"),
    ).json()
    assert workspace["daily_update"]["progress"].startswith("Dashboard validation")
    assert workspace["daily_update"]["next_steps"] == "Publish tomorrow."


