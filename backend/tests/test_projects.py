from __future__ import annotations

from fastapi.testclient import TestClient


def test_ad_hoc_is_provisioned_once_visible_and_usable(client: TestClient, team):
    first = client.get("/api/v1/projects", headers=team.auth("manager")).json()
    ad_hoc = [project for project in first if project["system_key"] == "ad_hoc"]
    assert len(ad_hoc) == 1
    assert ad_hoc[0]["name"] == "Ad hoc"

    second = client.get("/api/v1/projects", headers=team.auth("manager")).json()
    assert len([p for p in second if p["system_key"] == "ad_hoc"]) == 1

    employee_view = client.get("/api/v1/projects", headers=team.auth("alice")).json()
    assert any(project["system_key"] == "ad_hoc" for project in employee_view)

    created = client.post(
        "/api/v1/tasks",
        headers=team.auth("alice"),
        json={"project_id": ad_hoc[0]["id"], "title": "Unplanned analysis"},
    )
    assert created.status_code == 201, created.text

    archived = client.patch(
        f"/api/v1/projects/{ad_hoc[0]['id']}",
        headers=team.auth("manager"),
        json={"status": "archived"},
    )
    assert archived.status_code == 422


def test_project_counts_are_scoped_to_the_viewer(client: TestClient, team):
    ad_hoc = next(
        project
        for project in client.get("/api/v1/projects", headers=team.auth("manager")).json()
        if project["system_key"] == "ad_hoc"
    )
    client.post(
        "/api/v1/tasks",
        headers=team.auth("alice"),
        json={"project_id": ad_hoc["id"], "title": "Alice ad hoc"},
    )
    client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={"project_id": ad_hoc["id"], "title": "Bob ad hoc", "assignee_id": team.bob.id},
    )

    alice_view = next(
        project
        for project in client.get("/api/v1/projects", headers=team.auth("alice")).json()
        if project["system_key"] == "ad_hoc"
    )
    # Alice sees her created task, not Bob's manager-created task.
    assert sum(alice_view["task_counts"].values()) == 1

    manager_view = next(
        project
        for project in client.get("/api/v1/projects", headers=team.auth("manager")).json()
        if project["system_key"] == "ad_hoc"
    )
    assert sum(manager_view["task_counts"].values()) == 2


def test_project_owner_can_edit_without_being_manager(client: TestClient, team):
    created = client.post(
        "/api/v1/projects",
        headers=team.auth("manager"),
        json={
            "name": "Owner led",
            "description": "Owned by an employee",
            "owner_id": team.alice.id,
            "member_ids": [team.alice.id],
        },
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]

    alice_view = next(
        project
        for project in client.get("/api/v1/projects", headers=team.auth("alice")).json()
        if project["id"] == project_id
    )
    assert alice_view["can_edit"] is True

    edited = client.patch(
        f"/api/v1/projects/{project_id}",
        headers=team.auth("alice"),
        json={"name": "Owner led (renamed)"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Owner led (renamed)"

    membership = client.patch(
        f"/api/v1/projects/{project_id}",
        headers=team.auth("alice"),
        json={"member_ids": []},
    )
    assert membership.status_code == 403


def test_project_search(client: TestClient, team):
    body = client.get(
        "/api/v1/projects", headers=team.auth("manager"), params={"q": "alp"}
    ).json()
    assert [project["name"] for project in body] == ["Alpha"]
