from __future__ import annotations

import time

from fastapi.testclient import TestClient


def _create_update(
    client: TestClient,
    team,
    task_id: str,
    *,
    as_: str = "alice",
    progress: str = "Original progress",
    **extra,
) -> dict:
    response = client.post(
        f"/api/v1/tasks/{task_id}/updates",
        headers=team.auth(as_),
        json={"progress": progress, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _task(client: TestClient, team, task_id: str) -> dict:
    response = client.get(f"/api/v1/tasks/{task_id}", headers=team.auth("manager"))
    assert response.status_code == 200, response.text
    return response.json()


def _updates(client: TestClient, team, task_id: str) -> list[dict]:
    response = client.get(f"/api/v1/tasks/{task_id}/updates", headers=team.auth("manager"))
    assert response.status_code == 200, response.text
    return response.json()


def _activity(client: TestClient, team, task_id: str) -> list[dict]:
    response = client.get(f"/api/v1/tasks/{task_id}/activity", headers=team.auth("manager"))
    assert response.status_code == 200, response.text
    return response.json()


def test_author_can_edit_and_delete_own_update_with_audit(
    client: TestClient, team
):
    update = _create_update(
        client, team, team.dashboard.id, progress="Original", next_steps="First next step"
    )
    url = f"/api/v1/tasks/{team.dashboard.id}/updates/{update['id']}"

    edited = client.patch(url, headers=team.auth("alice"), json={"progress": "  Edited text  "})
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["progress"] == "Edited text"
    assert body["next_steps"] == "First next step"
    assert body["author"]["id"] == team.alice.id
    assert body["task_id"] == team.dashboard.id
    assert body["created_at"] == update["created_at"]

    cleared = client.patch(
        url,
        headers=team.auth("alice"),
        json={"progress": "Edited again", "next_steps": "   "},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["next_steps"] is None

    version = _task(client, team, team.dashboard.id)["version"]
    deleted = client.delete(url, headers=team.auth("alice"), params={"expected_version": version})
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert all(item["id"] != update["id"] for item in _updates(client, team, team.dashboard.id))

    events = _activity(client, team, team.dashboard.id)
    edit_event = next(
        event
        for event in events
        if event["event_type"] == "task.update_edited"
        and event["previous_values"]["progress"] == "Original"
    )
    delete_event = next(event for event in events if event["event_type"] == "task.update_deleted")
    for event in (edit_event, delete_event):
        assert event["entity_type"] == "task"
        assert event["entity_id"] == team.dashboard.id
        assert event["previous_values"]["update_id"] == update["id"]
        assert event["previous_values"]["author_id"] == team.alice.id
    assert edit_event["previous_values"]["progress"] == "Original"
    assert edit_event["new_values"]["progress"] == "Edited text"
    assert delete_event["previous_values"]["progress"] == "Edited again"
    assert delete_event["new_values"]["deleted"] is True


def test_manager_and_admin_can_edit_any_update(client: TestClient, team):
    update = _create_update(client, team, team.dashboard.id, progress="By Alice")
    url = f"/api/v1/tasks/{team.dashboard.id}/updates/{update['id']}"

    manager = client.patch(url, headers=team.auth("manager"), json={"progress": "By manager"})
    assert manager.status_code == 200, manager.text
    assert manager.json()["author"]["id"] == team.alice.id

    admin = client.patch(url, headers=team.auth("admin"), json={"progress": "By admin"})
    assert admin.status_code == 200, admin.text
    assert admin.json()["author"]["id"] == team.alice.id
    assert admin.json()["progress"] == "By admin"


def test_non_author_and_attributed_user_are_forbidden(client: TestClient, team):
    alice_update = _create_update(client, team, team.dashboard.id, progress="Alice wrote this")
    alice_url = f"/api/v1/tasks/{team.dashboard.id}/updates/{alice_update['id']}"
    assert client.patch(alice_url, headers=team.auth("bob"), json={"progress": "Nope"}).status_code == 403

    attributed = _create_update(
        client,
        team,
        team.dashboard.id,
        as_="manager",
        progress="Captured for Alice",
        attributed_to_user_id=team.alice.id,
    )
    attributed_url = f"/api/v1/tasks/{team.dashboard.id}/updates/{attributed['id']}"
    assert client.patch(attributed_url, headers=team.auth("alice"), json={"progress": "Nope"}).status_code == 403
    assert client.delete(attributed_url, headers=team.auth("alice")).status_code == 403

    bob_update = _create_update(client, team, team.bob_task.id, as_="bob", progress="Bob wrote this")
    manager_update = _create_update(
        client, team, team.bob_task.id, as_="manager", progress="Manager wrote this"
    )
    assert (
        client.patch(
            f"/api/v1/tasks/{team.bob_task.id}/updates/{manager_update['id']}",
            headers=team.auth("bob"),
            json={"progress": "Nope"},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/tasks/{team.bob_task.id}/updates/{bob_update['id']}",
            headers=team.auth("manager"),
            json={"progress": "Manager edit"},
        ).status_code
        == 200
    )


def test_inaccessible_mismatched_and_missing_updates(client: TestClient, team):
    update = _create_update(client, team, team.dashboard.id)
    path = f"/api/v1/tasks/{team.dashboard.id}/updates/{update['id']}"
    assert client.patch(path, headers=team.auth("bob"), json={"progress": "Nope"}).status_code == 403
    assert client.delete(path, headers=team.auth("bob")).status_code == 403

    mismatch = f"/api/v1/tasks/{team.overdue.id}/updates/{update['id']}"
    assert client.patch(mismatch, headers=team.auth("manager"), json={"progress": "Nope"}).status_code == 404
    assert client.delete(mismatch, headers=team.auth("manager")).status_code == 404
    missing = f"/api/v1/tasks/{team.dashboard.id}/updates/does-not-exist"
    assert client.patch(missing, headers=team.auth("alice"), json={"progress": "Nope"}).status_code == 404
    assert client.delete(missing, headers=team.auth("alice")).status_code == 404


def test_progress_validation_and_next_steps_preserve_or_clear(client: TestClient, team):
    update = _create_update(client, team, team.dashboard.id, progress="Original", next_steps="Keep me")
    url = f"/api/v1/tasks/{team.dashboard.id}/updates/{update['id']}"

    assert client.patch(url, headers=team.auth("alice"), json={"progress": "   "}).status_code == 422
    assert client.patch(url, headers=team.auth("alice"), json={}).status_code == 422

    preserved = client.patch(url, headers=team.auth("alice"), json={"progress": "Still here"})
    assert preserved.status_code == 200
    assert preserved.json()["next_steps"] == "Keep me"

    cleared = client.patch(
        url, headers=team.auth("alice"), json={"progress": "Gone", "next_steps": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["next_steps"] is None

    replaced = client.patch(
        url, headers=team.auth("alice"), json={"progress": "Replaced", "next_steps": "  New next  "}
    )
    assert replaced.status_code == 200
    assert replaced.json()["next_steps"] == "New next"
    assert _updates(client, team, team.dashboard.id)[0]["next_steps"] == "New next"


def test_edit_preserves_task_state_and_original_update_metadata(
    client: TestClient, team, today_session
):
    capture = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/updates",
        headers=team.auth("manager"),
        json={
            "task_id": team.dashboard.id,
            "progress": "Captured in the meeting",
            "attributed_to_user_id": team.alice.id,
        },
    )
    assert capture.status_code == 201, capture.text
    update = capture.json()
    assert update["source"] == "standup"
    before = _task(client, team, team.dashboard.id)
    fields = ("status", "assignee", "priority", "due_date", "blocked_by", "project_id", "title")

    edited = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}/updates/{update['id']}",
        headers=team.auth("manager"),
        json={"progress": "Edited meeting capture"},
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    for key in ("id", "task_id", "source", "session_id", "created_at"):
        assert body[key] == update[key], key
    assert body["author"]["id"] == team.manager.id
    assert body["attributed_to"]["id"] == team.alice.id
    assert body["progress"] == "Edited meeting capture"

    after = _task(client, team, team.dashboard.id)
    for key in fields:
        assert after[key] == before[key], key
    assert after["version"] == before["version"] + 1


def test_stale_versions_conflict_and_roll_back_audit(client: TestClient, team):
    update = _create_update(client, team, team.dashboard.id, progress="Original")
    url = f"/api/v1/tasks/{team.dashboard.id}/updates/{update['id']}"
    task = _task(client, team, team.dashboard.id)
    stale = task["version"] + 50
    activity_before = _activity(client, team, team.dashboard.id)

    conflict = client.patch(
        url,
        headers=team.auth("alice"),
        json={"progress": "Should not persist", "expected_version": stale},
    )
    assert conflict.status_code == 409
    assert conflict.json()["details"] == {
        "current_version": task["version"],
        "expected_version": stale,
    }
    after_edit = _updates(client, team, team.dashboard.id)[0]
    assert after_edit["progress"] == "Original"
    assert _task(client, team, team.dashboard.id)["version"] == task["version"]
    assert not any(
        event["event_type"] == "task.update_edited"
        for event in _activity(client, team, team.dashboard.id)
        if event["id"] not in {item["id"] for item in activity_before}
    )

    delete_conflict = client.delete(
        url, headers=team.auth("alice"), params={"expected_version": stale}
    )
    assert delete_conflict.status_code == 409
    assert delete_conflict.json()["details"]["current_version"] == task["version"]
    assert any(item["id"] == update["id"] for item in _updates(client, team, team.dashboard.id))
    new_events = [
        event
        for event in _activity(client, team, team.dashboard.id)
        if event["id"] not in {item["id"] for item in activity_before}
    ]
    assert not any(event["event_type"] == "task.update_deleted" for event in new_events)
    assert _task(client, team, team.dashboard.id)["version"] == task["version"]


def test_latest_update_falls_back_after_deleting_latest_and_only(
    client: TestClient, team
):
    first = _create_update(client, team, team.dashboard.id, progress="First update")
    time.sleep(0.01)
    second = _create_update(client, team, team.dashboard.id, progress="Second update")
    assert _task(client, team, team.dashboard.id)["latest_update"]["id"] == second["id"]

    latest_url = f"/api/v1/tasks/{team.dashboard.id}/updates/{second['id']}"
    assert client.delete(latest_url, headers=team.auth("alice")).status_code == 204
    detail = _task(client, team, team.dashboard.id)
    assert detail["latest_update"]["id"] == first["id"]
    assert [item["id"] for item in detail["updates"]] == [first["id"]]

    only_url = f"/api/v1/tasks/{team.dashboard.id}/updates/{first['id']}"
    assert client.delete(only_url, headers=team.auth("alice")).status_code == 204
    assert _task(client, team, team.dashboard.id)["latest_update"] is None
    assert _updates(client, team, team.dashboard.id) == []
