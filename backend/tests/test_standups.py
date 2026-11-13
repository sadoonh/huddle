from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient


def _workspace(client, team, session_id, user_id):
    response = client.get(
        f"/api/v1/standups/sessions/{session_id}/participants/{user_id}/workspace",
        headers=team.auth("manager"),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_only_one_session_per_date(client: TestClient, team, today_session):
    duplicate = client.post(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        json={"session_date": str(date.today()), "participant_ids": [team.alice.id]},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["details"]["session_id"] == today_session["id"]


def test_employees_submit_their_own_pre_meeting_update(client: TestClient, team, today_session):
    own = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}/pre-meeting",
        headers=team.auth("alice"),
        json={
            "progress": "Dashboard mostly done",
            "next_steps": "Validate the totals",
            "blockers": "Still waiting on schema access",
        },
    )
    assert own.status_code == 200, own.text
    participant = own.json()["participant"]
    assert participant["pre_meeting_progress"] == "Dashboard mostly done"
    assert participant["pre_meeting_submitted_at"] is not None

    manager_for_employee = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}/pre-meeting",
        headers=team.auth("manager"),
        json={"progress": "manager writing this"},
    )
    assert manager_for_employee.status_code == 403

    other_employee = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}/pre-meeting",
        headers=team.auth("bob"),
        json={"progress": "not mine"},
    )
    assert other_employee.status_code == 403


def test_workspace_prioritises_exceptions_and_hides_done_from_active(
    client: TestClient, team, today_session
):
    plain = client.post(
        "/api/v1/tasks",
        headers=team.auth("manager"),
        json={
            "project_id": team.project.id,
            "title": "Plain active work",
            "assignee_id": team.alice.id,
            "status": "in_progress",
            "due_date": str(date.today() + timedelta(days=5)),
        },
    )
    assert plain.status_code == 201

    workspace = _workspace(client, team, today_session["id"], team.alice.id)
    needs_titles = {t["title"] for t in workspace["needs_attention"]}
    active_titles = {t["title"] for t in workspace["active"]}
    other_titles = {t["title"] for t in workspace["other"]}

    assert {"Alpha dashboard", "Overdue reconciliation", "At risk model"} <= needs_titles
    assert "Plain active work" in active_titles
    assert "Finished task" not in active_titles
    assert "Finished task" in other_titles
    assert "Backlog idea" in other_titles

    dashboard = next(t for t in workspace["needs_attention"] if t["title"] == "Alpha dashboard")
    assert {"blocker"} <= set(dashboard["reasons"])
    overdue = next(t for t in workspace["needs_attention"] if t["title"] == "Overdue reconciliation")
    assert "overdue" in overdue["reasons"]


def test_carry_forward_and_resolution(
    client: TestClient, team, previous_standup, today_session
):
    workspace = _workspace(client, team, today_session["id"], team.alice.id)
    assert any(
        item["description"] == "Alice to validate the marketing schema next week"
        for item in workspace["carried_action_items"]
    )
    assert any(
        item["description"].startswith("Warehouse access")
        for item in workspace["carried_blockers"]
    )
    action_id = next(
        item["id"]
        for item in workspace["carried_action_items"]
        if item["description"].startswith("Alice to validate")
    )

    # Completing the follow-up removes it from carry-forward.
    completed = client.patch(
        f"/api/v1/action-items/{action_id}",
        headers=team.auth("alice"),
        json={"status": "completed"},
    )
    assert completed.status_code == 200, completed.text

    resolved = client.patch(
        f"/api/v1/standups/sessions/{today_session['id']}/blockers/{team.open_blocker.id}/resolve",
        headers=team.auth("manager"),
        json={"resolution_details": "Access granted"},
    )
    assert resolved.status_code == 200, resolved.text

    after = _workspace(client, team, today_session["id"], team.alice.id)
    assert after["carried_action_items"] == []
    assert after["carried_blockers"] == []


def test_completion_requires_reviews_unless_forced(client: TestClient, team, today_session):
    blocked = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/complete",
        headers=team.auth("manager"),
        json={},
    )
    assert blocked.status_code == 409
    assert set(blocked.json()["details"]["unreviewed_user_ids"]) == {
        team.alice.id,
        team.bob.id,
    }

    for participant_id in (team.alice.id, team.bob.id):
        reviewed = client.patch(
            f"/api/v1/standups/sessions/{today_session['id']}/participants/{participant_id}",
            headers=team.auth("manager"),
            json={"reviewed": True},
        )
        assert reviewed.status_code == 200

    forced = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/complete",
        headers=team.auth("manager"),
        json={},
    )
    assert forced.status_code == 200, forced.text
    assert "2/2 participants reviewed" in forced.json()["summary_text"]


def test_capture_records_inherit_session_and_employee(
    client: TestClient, team, today_session
):
    sid = today_session["id"]
    update = client.post(
        f"/api/v1/standups/sessions/{sid}/updates",
        headers=team.auth("manager"),
        json={
            "task_id": team.dashboard.id,
            "progress": "Validated totals with finance",
            "next_steps": "Publish the dashboard",
        },
    )
    assert update.status_code == 201, update.text
    assert update.json()["session_id"] == sid
    assert update.json()["attributed_to"]["id"] == team.alice.id
    assert update.json()["source"] == "standup"

    decision = client.post(
        f"/api/v1/standups/sessions/{sid}/decisions",
        headers=team.auth("manager"),
        json={"description": "Ship the dashboard this week", "task_id": team.dashboard.id},
    )
    assert decision.status_code == 201
    assert decision.json()["session_id"] == sid

    action = client.post(
        f"/api/v1/standups/sessions/{sid}/action-items",
        headers=team.auth("manager"),
        json={"description": "Bob to confirm access", "owner_id": team.bob.id},
    )
    assert action.status_code == 201
    assert action.json()["session_id"] == sid

    note = client.post(
        f"/api/v1/standups/sessions/{sid}/notes",
        headers=team.auth("manager"),
        json={"body": "Finance will join tomorrow."},
    )
    assert note.status_code == 201


def test_session_summary_counts_structured_records(
    client: TestClient, team, today_session
):
    sid = today_session["id"]
    client.post(
        f"/api/v1/standups/sessions/{sid}/updates",
        headers=team.auth("manager"),
        json={"task_id": team.dashboard.id, "progress": "Progress recorded"},
    )
    client.post(
        f"/api/v1/standups/sessions/{sid}/blockers",
        headers=team.auth("manager"),
        json={"description": "A new blocker", "task_id": team.at_risk.id},
    )
    client.post(
        f"/api/v1/standups/sessions/{sid}/action-items",
        headers=team.auth("manager"),
        json={"description": "Follow up tomorrow", "owner_id": team.alice.id},
    )
    summary = client.get(
        f"/api/v1/standups/sessions/{sid}/summary", headers=team.auth("manager")
    ).json()
    assert summary["updates"] == 1
    assert summary["blockers_created"] == 1
    assert summary["action_items"] == 1
    assert summary["open_action_items"] == 1
    assert "1 blocker(s) reported" in summary["summary_text"]


def test_history_reconstructs_what_an_employee_reported(
    client: TestClient, team, previous_standup
):
    history = client.get(
        f"/api/v1/standups/users/{team.alice.id}/history",
        headers=team.auth("manager"),
    )
    assert history.status_code == 200, history.text
    body = history.json()
    assert len(body["entries"]) == 1
    entry = body["entries"][0]
    assert entry["participant"]["pre_meeting_progress"] == "Prior update from Alice"
    assert any(u["progress"] == "Captured during yesterday's standup" for u in entry["updates"])
    assert any(a["description"].startswith("Alice to validate") for a in entry["action_items"])


def test_employee_cannot_read_another_employees_history(client: TestClient, team):
    response = client.get(
        f"/api/v1/standups/users/{team.alice.id}/history", headers=team.auth("bob")
    )
    assert response.status_code == 403


def test_pre_meeting_stays_open_during_live_until_reviewed(
    client: TestClient, team, today_session
):
    started = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/start",
        headers=team.auth("manager"),
    )
    assert started.status_code == 200
    late = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}/pre-meeting",
        headers=team.auth("alice"),
        json={"progress": "Submitted just before my turn"},
    )
    assert late.status_code == 200, late.text

    reviewed = client.patch(
        f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}",
        headers=team.auth("manager"),
        json={"reviewed": True},
    )
    assert reviewed.status_code == 200
    closed = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/participants/{team.alice.id}/pre-meeting",
        headers=team.auth("alice"),
        json={"progress": "Too late"},
    )
    assert closed.status_code == 409


def test_session_captures_returns_every_structured_type(
    client: TestClient, team, today_session
):
    sid = today_session["id"]
    client.post(
        f"/api/v1/standups/sessions/{sid}/updates",
        headers=team.auth("manager"),
        json={"task_id": team.dashboard.id, "progress": "Captured update"},
    )
    client.post(
        f"/api/v1/standups/sessions/{sid}/blockers",
        headers=team.auth("manager"),
        json={"description": "Captured blocker", "task_id": team.dashboard.id},
    )
    client.post(
        f"/api/v1/standups/sessions/{sid}/action-items",
        headers=team.auth("manager"),
        json={"description": "Captured follow-up", "owner_id": team.alice.id},
    )
    client.post(
        f"/api/v1/standups/sessions/{sid}/decisions",
        headers=team.auth("manager"),
        json={"description": "Captured decision"},
    )
    client.post(
        f"/api/v1/standups/sessions/{sid}/notes",
        headers=team.auth("manager"),
        json={"body": "Captured note"},
    )
    captures = client.get(
        f"/api/v1/standups/sessions/{sid}/captures", headers=team.auth("manager")
    )
    assert captures.status_code == 200
    body = captures.json()
    assert len(body["updates"]) == 1
    assert len(body["blockers"]) == 1
    assert len(body["action_items"]) == 1
    assert len(body["decisions"]) == 1
    assert len(body["notes"]) == 1
