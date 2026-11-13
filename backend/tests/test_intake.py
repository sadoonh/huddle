from __future__ import annotations

from fastapi.testclient import TestClient


def test_employee_creates_request_and_manager_reviews(client: TestClient, team):
    created = client.post(
        "/api/v1/intake",
        headers=team.auth("alice"),
        json={
            "title": "Add churn to the weekly digest",
            "description": "Exec asked for churn alongside revenue.",
            "priority": "high",
        },
    )
    assert created.status_code == 201, created.text
    request = created.json()
    assert request["status"] == "new"
    assert request["requester"]["id"] == team.alice.id

    # Employees see their own requests only.
    assert any(i["id"] == request["id"] for i in client.get(
        "/api/v1/intake", headers=team.auth("alice")
    ).json()["items"])
    assert not any(i["id"] == request["id"] for i in client.get(
        "/api/v1/intake", headers=team.auth("bob")
    ).json()["items"])
    assert any(i["id"] == request["id"] for i in client.get(
        "/api/v1/intake", headers=team.auth("manager")
    ).json()["items"])

    forbidden = client.patch(
        f"/api/v1/intake/{request['id']}",
        headers=team.auth("alice"),
        json={"status": "accepted"},
    )
    assert forbidden.status_code == 403

    reviewed = client.patch(
        f"/api/v1/intake/{request['id']}",
        headers=team.auth("manager"),
        json={"status": "accepted", "review_note": "Fits this sprint"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "accepted"
    assert reviewed.json()["reviewed_by"]["id"] == team.manager.id


def test_convert_request_to_task_and_reject_double_conversion(client: TestClient, team):
    request = client.post(
        "/api/v1/intake",
        headers=team.auth("alice"),
        json={"title": "Automate the monthly deck", "priority": "medium"},
    ).json()

    converted = client.post(
        f"/api/v1/intake/{request['id']}/convert-to-task",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "assignee_id": team.alice.id,
            "due_date": "2026-12-01",
        },
    )
    assert converted.status_code == 200, converted.text
    body = converted.json()
    assert body["status"] == "converted"
    assert body["converted_task_id"]

    task = client.get(
        f"/api/v1/tasks/{body['converted_task_id']}", headers=team.auth("manager")
    ).json()
    assert task["title"] == "Automate the monthly deck"
    assert task["assignee"]["id"] == team.alice.id

    again = client.post(
        f"/api/v1/intake/{request['id']}/convert-to-task",
        headers=team.auth("manager"),
        json={"project_id": team.project.id},
    )
    assert again.status_code == 409


def test_convert_request_to_project(client: TestClient, team):
    request = client.post(
        "/api/v1/intake",
        headers=team.auth("bob"),
        json={"title": "New experimentation workstream"},
    ).json()
    converted = client.post(
        f"/api/v1/intake/{request['id']}/convert-to-project",
        headers=team.auth("manager"),
        json={"member_ids": [team.alice.id]},
    )
    assert converted.status_code == 200, converted.text
    body = converted.json()
    assert body["status"] == "converted"
    project = client.get(
        f"/api/v1/projects/{body['converted_project_id']}", headers=team.auth("manager")
    ).json()
    assert project["name"] == "New experimentation workstream"
