from __future__ import annotations

from fastapi.testclient import TestClient

from app.schemas.standups import ProgressCapture
from app.services import standups as standup_service


def test_task_update_audit_has_session_actor_and_source(
    client: TestClient, team, today_session, db
):
    standup_service.capture_progress(
        db,
        team.manager,
        today_session["id"],
        ProgressCapture(
            task_id=team.dashboard.id,
            progress="Recorded for the audit test",
            attributed_to_user_id=team.alice.id,
        ),
    )
    db.commit()

    events = client.get(
        "/api/v1/audit",
        headers=team.auth("manager"),
        params={"session_id": today_session["id"], "event_type": "task.update_added"},
    ).json()
    assert events["total"] == 1
    event = events["items"][0]
    assert event["source"] == "manager_action"
    assert event["session_id"] == today_session["id"]
    assert event["actor"]["email"] == "manager@test.local"
    assert event["new_values"]["progress"] == "Recorded for the audit test"


def test_audit_is_append_only(client: TestClient, team):
    task = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={"project_id": team.project.id, "title": "Audited task"},
    ).json()
    before = client.get(
        "/api/v1/audit",
        headers=team.auth("manager"),
        params={"entity_type": "task", "entity_id": task["id"]},
    ).json()["total"]
    client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=team.auth("manager"),
        json={"title": "Audited task renamed"},
    )
    after = client.get(
        "/api/v1/audit",
        headers=team.auth("manager"),
        params={"entity_type": "task", "entity_id": task["id"]},
    ).json()
    assert after["total"] == before + 1
    # No mutation verb is exposed for audit records.
    assert client.delete("/api/v1/audit", headers=team.auth("manager")).status_code == 405


def test_employee_audit_scope_is_limited(client: TestClient, team):
    client.patch(
        f"/api/v1/tasks/{team.bob_task.id}",
        headers=team.auth("manager"),
        json={"title": "Bob task renamed"},
    )
    alice_view = client.get(
        "/api/v1/audit",
        headers=team.auth("alice"),
        params={"entity_id": team.bob_task.id},
    ).json()
    assert alice_view["total"] == 0

    bob_view = client.get(
        "/api/v1/audit",
        headers=team.auth("bob"),
        params={"entity_id": team.bob_task.id},
    ).json()
    assert bob_view["total"] >= 1
