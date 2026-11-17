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


def test_description_created_with_task_becomes_the_first_update(client: TestClient, team):
    created = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "title": "New task with context",
            "description": "Kickoff context from the creator.",
        },
    )
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["description"] == "Kickoff context from the creator."

    updates = client.get(
        f"/api/v1/tasks/{task['id']}/updates", headers=team.auth("manager")
    ).json()
    assert len(updates) == 1
    assert updates[0]["progress"] == "Kickoff context from the creator."
    assert updates[0]["author"]["id"] == team.manager.id


def test_unassigned_owner_filter_returns_only_tasks_without_an_assignee(
    client: TestClient, team
):
    created = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={"project_id": team.project.id, "title": "Nobody owns this yet"},
    )
    assert created.status_code == 201, created.text

    response = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"assignee_id": "unassigned", "limit": 200},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert items
    assert all(item["assignee"] is None for item in items)
    ids = {item["id"] for item in items}
    assert created.json()["id"] in ids
    assert team.dashboard.id not in ids


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


def test_at_risk_fields_are_removed_from_the_contract(client: TestClient, team):
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert "is_at_risk" not in detail
    assert "at_risk_reason" not in detail

    created = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "title": "Legacy at-risk payload",
            "is_at_risk": True,
            "at_risk_reason": "should be ignored",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert "is_at_risk" not in body
    assert "at_risk_reason" not in body


def test_legacy_blocker_no_longer_drives_active_flags(client: TestClient, team):
    detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert detail["status"] == "in_progress"
    # The fixture has an open legacy Blocker row, which is no longer active.
    assert detail["is_blocked"] is False
    assert detail["open_blocker_count"] == 0

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
    assert after["is_blocked"] is False
    assert after["open_blocker_count"] == 0

    # Free text is the active signal.
    blocked = client.patch(
        f"/api/v1/tasks/{team.at_risk.id}",
        headers=team.auth("manager"),
        json={"blocked_by": "Vendor credentials missing"},
    )
    assert blocked.status_code == 200
    assert blocked.json()["is_blocked"] is True


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


def test_task_capabilities_reflect_edit_permissions(client: TestClient, team):
    """:can_move mirrors the edit permission used by the status endpoint."""
    manager_items = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"limit": 200}
    ).json()["items"]
    assert {t["id"]: t for t in manager_items}[team.dashboard.id]["can_move"] is True

    alice_detail = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("alice")
    ).json()
    assert alice_detail["can_move"] is True

    bob_items = client.get(
        "/api/v1/tasks", headers=team.auth("bob"), params={"limit": 200}
    ).json()["items"]
    visible = {t["id"]: t for t in bob_items}
    assert team.bob_task.id in visible
    assert visible[team.bob_task.id]["can_move"] is True
    # Bob cannot see Alice's task, and the API still refuses a direct move.
    assert team.dashboard.id not in visible
    forbidden = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}/status",
        headers=team.auth("bob"),
        json={"status": "done"},
    )
    assert forbidden.status_code == 403


def test_task_listing_pages_are_stable_and_ordered(client: TestClient, team):
    first = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"limit": 2, "offset": 0}
    ).json()
    second = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"limit": 2, "offset": 2}
    ).json()
    first_ids = {task["id"] for task in first["items"]}
    second_ids = {task["id"] for task in second["items"]}
    assert first_ids.isdisjoint(second_ids)

    all_items = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"limit": 200}
    ).json()["items"]
    keys = [
        (tuple(-ord(char) for char in item["updated_at"]), item["id"])
        for item in all_items
    ]
    assert keys == sorted(keys)


def test_task_list_sorting_applies_to_the_filtered_set(client: TestClient, team):
    by_title = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"sort": "title", "limit": 200},
    ).json()["items"]
    titles = [item["title"].lower() for item in by_title]
    assert titles == sorted(titles)

    reverse = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"sort": "-title", "limit": 200},
    ).json()["items"]
    reverse_titles = [item["title"].lower() for item in reverse]
    assert reverse_titles == sorted(reverse_titles, reverse=True)

    by_due = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"sort": "due", "limit": 200},
    ).json()["items"]
    default = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"limit": 200},
    ).json()["items"]
    # Legacy due-date sort links normalise to -updated.
    assert [item["id"] for item in by_due] == [item["id"] for item in default]
    expected = sorted(default, key=lambda t: t["id"])
    expected.sort(key=lambda t: t["updated_at"], reverse=True)
    assert [item["id"] for item in by_due] == [item["id"] for item in expected]

    # The obsolete overdue flag is accepted but ignored.
    overdue = client.get(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        params={"overdue": True, "limit": 200},
    ).json()["items"]
    assert {item["id"] for item in overdue} == {item["id"] for item in default}

    invalid = client.get(
        "/api/v1/tasks", headers=team.auth("manager"), params={"sort": "priority"}
    )
    assert invalid.status_code == 422
