from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_task_records_audit_and_version(client: TestClient, team):
    response = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "title": "New reporting task",
            "assignee_id": team.alice.id,
            "priority": "high",
            "status": "todo",
        },
    )
    assert response.status_code == 201, response.text
    task = response.json()
    assert task["version"] == 1
    assert task["assignee"]["full_name"] == "Alice Analyst"

    audit = client.get(
        "/api/v1/audit",
        headers=team.auth("manager"),
        params={"entity_type": "task", "entity_id": task["id"]},
    ).json()
    assert audit["total"] >= 1
    assert any(event["event_type"] == "task.created" for event in audit["items"])


def test_status_change_sets_completed_at_and_reopen_clears_it(client: TestClient, team):
    url = f"/api/v1/tasks/{team.dashboard.id}/status"
    done = client.patch(url, headers=team.auth("manager"), json={"status": "done"})
    assert done.status_code == 200
    assert done.json()["completed_at"] is not None
    assert done.json()["version"] == 2

    reopened = client.patch(url, headers=team.auth("manager"), json={"status": "in_progress"})
    assert reopened.status_code == 200
    assert reopened.json()["completed_at"] is None
    assert reopened.json()["version"] == 3


def test_optimistic_concurrency_returns_409(client: TestClient, team):
    first = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}",
        headers=team.auth("manager"),
        json={"title": "Renamed once", "expected_version": 1},
    )
    assert first.status_code == 200

    stale = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}",
        headers=team.auth("manager"),
        json={"title": "Renamed from a stale tab", "expected_version": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["details"]["current_version"] == 2


def test_employee_cannot_reassign_tasks(client: TestClient, team):
    response = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}",
        headers=team.auth("alice"),
        json={"assignee_id": team.bob.id},
    )
    assert response.status_code == 403


def test_blocker_is_separate_from_workflow_status(client: TestClient, team):
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert detail["status"] == "in_progress"
    assert detail["is_blocked"] is True
    assert detail["open_blocker_count"] == 1

    created = client.post(
        f"/api/v1/tasks/{team.at_risk.id}/blockers",
        headers=team.auth("manager"),
        json={"description": "Vendor credentials missing", "owner_id": team.alice.id},
    )
    assert created.status_code == 201
    after = client.get(
        f"/api/v1/tasks/{team.at_risk.id}", headers=team.auth("manager")
    ).json()
    assert after["status"] == "in_progress"
    assert after["is_blocked"] is True


def test_resolving_a_blocker_preserves_task_status(client: TestClient, team):
    response = client.patch(
        f"/api/v1/blockers/{team.open_blocker.id}/resolve",
        headers=team.auth("manager"),
        json={"resolution_details": "Access granted by platform team"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "resolved"
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert detail["status"] == "in_progress"
    assert detail["is_blocked"] is False


def test_progress_updates_are_append_only(client: TestClient, team):
    url = f"/api/v1/tasks/{team.dashboard.id}/updates"
    first = client.post(
        url, headers=team.auth("alice"), json={"progress": "First pass complete"}
    )
    second = client.post(
        url,
        headers=team.auth("alice"),
        json={"progress": "Second pass complete", "next_steps": "Validate totals"},
    )
    assert first.status_code == 201 and second.status_code == 201

    updates = client.get(url, headers=team.auth("manager")).json()
    assert len(updates) == 2
    assert {u["progress"] for u in updates} == {"First pass complete", "Second pass complete"}


def test_employee_cannot_view_or_edit_another_employees_task(client: TestClient, team):
    assert (
        client.get(
            f"/api/v1/tasks/{team.bob_task.id}", headers=team.auth("alice")
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/tasks/{team.bob_task.id}",
            headers=team.auth("alice"),
            json={"title": "hijacked"},
        ).status_code
        == 403
    )


def test_task_detail_includes_history_and_relations(client: TestClient, team):
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert detail["project_name"] == "Alpha"
    assert detail["blockers"][0]["description"].startswith("Warehouse access")
    assert isinstance(detail["updates"], list)


def test_cannot_create_a_task_already_done(client: TestClient, team):
    response = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "title": "Already finished",
            "status": "done",
        },
    )
    assert response.status_code == 422
