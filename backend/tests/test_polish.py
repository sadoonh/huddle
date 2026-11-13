from __future__ import annotations

import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient


def _updates(client: TestClient, team, task_id: str) -> list[dict]:
    return client.get(
        f"/api/v1/tasks/{task_id}/updates", headers=team.auth("manager")
    ).json()


def test_progress_and_status_are_atomic_and_idempotent(client: TestClient, team):
    operation_id = str(uuid.uuid4())
    before = _updates(client, team, team.dashboard.id)

    conflict = client.post(
        f"/api/v1/tasks/{team.dashboard.id}/updates",
        headers=team.auth("alice"),
        json={
            "progress": "Should not persist on a stale status change",
            "status": "done",
            "expected_version": 999,
            "client_operation_id": operation_id,
        },
    )
    assert conflict.status_code == 409
    assert len(_updates(client, team, team.dashboard.id)) == len(before)
    assert (
        client.get(f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager"))
        .json()["status"]
        == "in_progress"
    )

    task = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    saved = client.post(
        f"/api/v1/tasks/{team.dashboard.id}/updates",
        headers=team.auth("alice"),
        json={
            "progress": "Validated and ready to close",
            "status": "done",
            "expected_version": task["version"],
            "client_operation_id": operation_id,
        },
    )
    assert saved.status_code == 201, saved.text
    saved_id = saved.json()["id"]
    assert (
        client.get(f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager"))
        .json()["status"]
        == "done"
    )
    assert len(_updates(client, team, team.dashboard.id)) == len(before) + 1

    retried = client.post(
        f"/api/v1/tasks/{team.dashboard.id}/updates",
        headers=team.auth("alice"),
        json={
            "progress": "Validated and ready to close",
            "status": "done",
            "expected_version": task["version"],
            "client_operation_id": operation_id,
        },
    )
    assert retried.status_code == 201
    assert retried.json()["id"] == saved_id
    assert len(_updates(client, team, team.dashboard.id)) == len(before) + 1


def test_create_paths_are_idempotent(client: TestClient, team):
    task_op = str(uuid.uuid4())
    task_payload = {
        "project_id": team.project.id,
        "title": "Idempotent task",
        "client_operation_id": task_op,
    }
    first = client.post("/api/v1/tasks", headers=team.auth("manager"), json=task_payload)
    second = client.post("/api/v1/tasks", headers=team.auth("manager"), json=task_payload)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"q": "Idempotent task"}
    ).json()["total"] == 1

    blocker_op = str(uuid.uuid4())
    blocker_payload = {
        "description": "Idempotent help request",
        "client_operation_id": blocker_op,
    }
    blocker_one = client.post("/api/v1/blockers", headers=team.auth("alice"), json=blocker_payload)
    blocker_two = client.post("/api/v1/blockers", headers=team.auth("alice"), json=blocker_payload)
    assert blocker_one.status_code == 201
    assert blocker_one.json()["id"] == blocker_two.json()["id"]

    action_op = str(uuid.uuid4())
    action_payload = {
        "description": "Idempotent follow-up",
        "owner_id": team.alice.id,
        "client_operation_id": action_op,
    }
    action_one = client.post("/api/v1/action-items", headers=team.auth("manager"), json=action_payload)
    action_two = client.post("/api/v1/action-items", headers=team.auth("manager"), json=action_payload)
    assert action_one.status_code == 201
    assert action_one.json()["id"] == action_two.json()["id"]

    decision_op = str(uuid.uuid4())
    decision_payload = {
        "description": "Idempotent decision",
        "client_operation_id": decision_op,
    }
    decision_one = client.post("/api/v1/decisions", headers=team.auth("manager"), json=decision_payload)
    decision_two = client.post("/api/v1/decisions", headers=team.auth("manager"), json=decision_payload)
    assert decision_one.status_code == 201
    assert decision_one.json()["id"] == decision_two.json()["id"]


def test_note_idempotency_and_daily_update_reporting(client: TestClient, team, today_session):
    sid = today_session["id"]
    op = str(uuid.uuid4())
    payload = {"body": "A saved general note", "client_operation_id": op}
    first = client.post(f"/api/v1/standups/sessions/{sid}/notes", headers=team.auth("manager"), json=payload)
    second = client.post(f"/api/v1/standups/sessions/{sid}/notes", headers=team.auth("manager"), json=payload)
    assert first.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    captures = client.get(
        f"/api/v1/standups/sessions/{sid}/captures", headers=team.auth("manager")
    ).json()
    assert len(captures["notes"]) == 1

    client.put(
        "/api/v1/daily-updates/today",
        headers=team.auth("alice"),
        json={"progress": "Daily note visible in history", "next_steps": "Finish the task."},
    )
    session = client.post(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        json={"participant_ids": [team.alice.id]},
    )
    sid = (
        session.json()["details"]["session_id"]
        if session.status_code == 409
        else session.json()["id"]
    )
    detail = client.get(f"/api/v1/standups/sessions/{sid}", headers=team.auth("manager")).json()
    alice = next(p for p in detail["participants"] if p["user"]["id"] == team.alice.id)
    assert alice["daily_update"]["progress"] == "Daily note visible in history"
    assert alice["daily_update"]["next_steps"] == "Finish the task."


def test_attention_contract_includes_issue_records_and_business_date(client: TestClient, team):
    body = client.get("/api/v1/today", headers=team.auth("manager")).json()
    assert body["business_date"] == date.today().isoformat()
    dashboard = next(item for item in body["attention"]["items"] if item["task_id"] == team.dashboard.id)
    assert dashboard["focus_id"] == team.open_blocker.id
    assert dashboard["issues"][0]["kind"] == "blocker"
    assert dashboard["issues"][0]["id"] == team.open_blocker.id
    assert dashboard["reporter"]["id"] == team.manager.id


def test_standup_history_date_filter(client: TestClient, team, previous_standup):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    included = client.get(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        params={"start": yesterday, "end": yesterday},
    ).json()
    assert included["total"] == 1
    excluded = client.get(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        params={"start": date.today().isoformat()},
    ).json()
    assert excluded["total"] == 0
