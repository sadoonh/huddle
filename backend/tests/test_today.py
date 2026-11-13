from __future__ import annotations

from fastapi.testclient import TestClient


def test_employee_today_merges_task_exceptions_and_keeps_taskless_items(
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
        item for item in body["attention"]["items"] if item["task_id"] == team.dashboard.id
    ]
    assert len(dashboard_rows) == 1
    assert {"blocker", "follow_up"} <= set(dashboard_rows[0]["reasons"])

    kinds = [(item["kind"], item["id"]) for item in body["attention"]["items"]]
    assert ("blocker", blocker.json()["id"]) in kinds
    assert ("action_item", action.json()["id"]) in kinds

    # Completed and backlog work is not in the daily current-work preview.
    current_ids = {task["id"] for task in body["current_work"]["items"]}
    assert team.dashboard.id in current_ids
    assert team.done.id not in current_ids
    assert team.backlog.id not in current_ids


def test_today_paginates_full_attention_set(client: TestClient, team):
    for index in range(4):
        client.post(
            "/api/v1/blockers",
            headers=team.auth("manager"),
            json={"description": f"Team blocker {index}", "owner_id": team.alice.id},
        )

    full = client.get("/api/v1/today", headers=team.auth("manager")).json()
    total = full["attention"]["total"]
    assert total >= 4

    page = client.get(
        "/api/v1/today",
        headers=team.auth("manager"),
        params={"attention_limit": 2, "attention_offset": 1},
    ).json()
    assert page["attention"]["total"] == total
    assert len(page["attention"]["items"]) == 2


def test_manager_today_has_team_attention_and_no_personal_preview(
    client: TestClient, team
):
    body = client.get("/api/v1/today", headers=team.auth("manager")).json()
    assert body["current_work"]["items"] == []
    titles = {item["title"] for item in body["attention"]["items"]}
    assert "Alpha dashboard" in titles
    assert "Overdue reconciliation" in titles


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


def test_session_outcomes_are_outcome_first(client: TestClient, team, today_session):
    sid = today_session["id"]
    action = client.post(
        f"/api/v1/standups/sessions/{sid}/action-items",
        headers=team.auth("manager"),
        json={"description": "Send the reconciliation pack", "owner_id": team.alice.id},
    )
    assert action.status_code == 201

    decision = client.post(
        f"/api/v1/standups/sessions/{sid}/decisions",
        headers=team.auth("manager"),
        json={"description": "Publish after finance sign-off"},
    )
    assert decision.status_code == 201

    blocker = client.post(
        f"/api/v1/standups/sessions/{sid}/blockers",
        headers=team.auth("manager"),
        json={"description": "Finance has not signed off", "task_id": team.dashboard.id},
    )
    assert blocker.status_code == 201

    outcomes = client.get(
        f"/api/v1/standups/sessions/{sid}/outcomes", headers=team.auth("manager")
    )
    assert outcomes.status_code == 200, outcomes.text
    body = outcomes.json()
    assert any(item["id"] == action.json()["id"] for item in body["action_items"])
    assert any(item["id"] == decision.json()["id"] for item in body["decisions"])
    assert any(item["id"] == blocker.json()["id"] for item in body["unresolved_blockers"])

    client.patch(
        f"/api/v1/blockers/{blocker.json()['id']}/resolve",
        headers=team.auth("manager"),
        json={"resolution_details": "Finance signed off"},
    )
    refreshed = client.get(
        f"/api/v1/standups/sessions/{sid}/outcomes", headers=team.auth("manager")
    ).json()
    assert not any(
        item["id"] == blocker.json()["id"] for item in refreshed["unresolved_blockers"]
    )
