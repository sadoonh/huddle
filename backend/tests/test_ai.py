from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.enums import TranscriptStatus
from app.models import Transcript

TRANSCRIPT = """[09:01:02] Alice Analyst: Yesterday I finished the Alpha dashboard and next I will validate totals.
[09:02:10] Alice Analyst: I'm blocked on warehouse access for the marketing schema.
[09:03:00] Maya Manager: Decision: we will move the launch to next month.
[09:04:00] Maya Manager: Action item: Bob to review the data quality checks by Friday.
"""


def _upload(client: TestClient, team, session_id: str, text: str = TRANSCRIPT):
    return client.post(
        "/api/v1/ai/transcripts",
        headers=team.auth("manager"),
        files={"file": ("standup.txt", text, "text/plain")},
        data={"session_id": session_id},
    )


def _proposal(client, team, transcript_id, operation):
    proposals = client.get(
        "/api/v1/ai/proposals",
        headers=team.auth("manager"),
        params={"transcript_id": transcript_id},
    ).json()
    return next(p for p in proposals if p["operation"] == operation)


def test_upload_generates_proposals_without_mutating_tasks(
    client: TestClient, team, today_session
):
    before = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()

    response = _upload(client, team, today_session["id"])
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "processed"
    assert body["proposal_count"] >= 4

    operations = {p["operation"] for p in body["proposals"]}
    assert {"add_progress_update", "create_blocker", "record_decision", "create_action_item"} <= operations
    # Human control: nothing has been applied.
    assert all(p["status"] == "pending" for p in body["proposals"])

    after = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert after["version"] == before["version"]
    assert after["status"] == before["status"]


def test_apply_requires_approval_then_records_audit(client: TestClient, team, today_session):
    upload = _upload(client, team, today_session["id"]).json()
    proposal = next(
        p for p in upload["proposals"] if p["operation"] == "add_progress_update"
    )
    assert proposal["target_id"] == team.dashboard.id

    not_approved = client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/apply", headers=team.auth("manager")
    )
    assert not_approved.status_code == 409

    approved = client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/approve",
        headers=team.auth("manager"),
        json={},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    applied = client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/apply", headers=team.auth("manager")
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"] == "applied"

    updates = client.get(
        f"/api/v1/tasks/{team.dashboard.id}/updates", headers=team.auth("manager")
    ).json()
    assert any(u["source"] == "ai_approved" for u in updates)

    audit = client.get(
        "/api/v1/audit",
        headers=team.auth("manager"),
        params={"entity_id": team.dashboard.id},
    ).json()
    assert any(
        event["event_type"] == "task.update_added" and event["source"] == "ai_approved"
        for event in audit["items"]
    )


def test_manager_can_edit_a_proposal_before_applying(client: TestClient, team, today_session):
    upload = _upload(client, team, today_session["id"]).json()
    proposal = next(
        p for p in upload["proposals"] if p["operation"] == "add_progress_update"
    )
    edited = client.patch(
        f"/api/v1/ai/proposals/{proposal['id']}",
        headers=team.auth("manager"),
        json={
            "payload": {
                "progress": "Manager-edited progress text",
                "next_steps": "Manager-edited next step",
                "attributed_to_user_id": team.alice.id,
            },
            "review_note": "Trimmed the transcript wording",
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["payload"]["progress"] == "Manager-edited progress text"

    client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/approve",
        headers=team.auth("manager"),
        json={},
    )
    applied = client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/apply", headers=team.auth("manager")
    )
    assert applied.status_code == 200
    updates = client.get(
        f"/api/v1/tasks/{team.dashboard.id}/updates", headers=team.auth("manager")
    ).json()
    assert any(u["progress"] == "Manager-edited progress text" for u in updates)


def test_reject_prevents_application(client: TestClient, team, today_session):
    upload = _upload(client, team, today_session["id"]).json()
    proposal = upload["proposals"][0]
    rejected = client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/reject",
        headers=team.auth("manager"),
        json={"note": "Not what was agreed"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    applied = client.post(
        f"/api/v1/ai/proposals/{proposal['id']}/apply", headers=team.auth("manager")
    )
    assert applied.status_code == 409


def test_duplicate_detection_against_records_captured_in_the_meeting(
    client: TestClient, team, today_session
):
    text = "Yesterday I finished the Alpha dashboard and next I will validate totals."
    captured = client.post(
        f"/api/v1/standups/sessions/{today_session['id']}/updates",
        headers=team.auth("manager"),
        json={
            "task_id": team.dashboard.id,
            "progress": text,
            "next_steps": "I will validate totals.",
        },
    )
    assert captured.status_code == 201

    upload = _upload(client, team, today_session["id"]).json()
    progress = next(
        p for p in upload["proposals"] if p["operation"] == "add_progress_update"
    )
    assert progress["duplicate_of_type"] == "task_update"
    assert progress["duplicate_of_id"] == captured.json()["id"]


def test_conflict_detection_blocks_stale_proposals(client: TestClient, team, today_session):
    upload = _upload(client, team, today_session["id"]).json()
    status_proposal = next(
        p for p in upload["proposals"] if p["operation"] == "update_task_status"
    )
    assert status_proposal["payload"]["status"] == "done"

    client.post(
        f"/api/v1/ai/proposals/{status_proposal['id']}/approve",
        headers=team.auth("manager"),
        json={},
    )
    # The task changes after the proposal was generated.
    changed = client.patch(
        f"/api/v1/tasks/{team.dashboard.id}",
        headers=team.auth("manager"),
        json={"title": "Alpha dashboard (renamed after proposal)"},
    )
    assert changed.status_code == 200

    applied = client.post(
        f"/api/v1/ai/proposals/{status_proposal['id']}/apply",
        headers=team.auth("manager"),
    )
    assert applied.status_code == 409
    assert "changed" in applied.json()["detail"].lower()

    proposal_after = client.get(
        f"/api/v1/ai/proposals/{status_proposal['id']}", headers=team.auth("manager")
    ).json()
    assert proposal_after["status"] == "failed"
    assert "changed" in proposal_after["failure_reason"].lower()

    # The newer task state was not overwritten.
    task_after = client.get(
        f"/api/v1/tasks/{team.dashboard.id}", headers=team.auth("manager")
    ).json()
    assert task_after["status"] == "in_progress"
    assert task_after["title"] == "Alpha dashboard (renamed after proposal)"


def test_ambiguous_task_match_is_flagged(client: TestClient, team, today_session):
    upload = _upload(client, team, today_session["id"]).json()
    blocker = next(p for p in upload["proposals"] if p["operation"] == "create_blocker")
    assert blocker["is_ambiguous"] is True
    assert blocker["target_id"] is None


def test_non_managers_cannot_upload_transcripts(client: TestClient, team, today_session):
    response = _upload(client, team, today_session["id"])
    assert response.status_code == 201
    as_employee = client.post(
        "/api/v1/ai/transcripts",
        headers=team.auth("alice"),
        files={"file": ("x.txt", TRANSCRIPT, "text/plain")},
        data={"session_id": today_session["id"]},
    )
    assert as_employee.status_code == 403


def test_transcript_listing_and_failure_is_visible(client: TestClient, team, today_session):
    upload = _upload(client, team, today_session["id"]).json()
    listing = client.get("/api/v1/ai/transcripts", headers=team.auth("manager")).json()
    assert any(t["id"] == upload["id"] for t in listing)

    empty = _upload(client, team, today_session["id"], text="   ")
    assert empty.status_code == 422


def test_worker_processes_an_uploaded_transcript(
    client: TestClient, team, today_session, db
):
    from app.worker import handler

    transcript = Transcript(
        session_id=today_session["id"],
        filename="async.txt",
        content_text=TRANSCRIPT,
        size_bytes=len(TRANSCRIPT),
        uploaded_by_id=team.manager.id,
        status=TranscriptStatus.UPLOADED,
    )
    db.add(transcript)
    db.commit()

    result = handler(
        {"Records": [{"body": json.dumps({"transcript_id": transcript.id})}]}
    )
    assert result == {"processed": 1, "failed": 0}

    db.expire_all()
    refreshed = db.get(Transcript, transcript.id)
    assert refreshed is not None
    assert refreshed.status == TranscriptStatus.PROCESSED

    proposals = client.get(
        "/api/v1/ai/proposals",
        headers=team.auth("manager"),
        params={"transcript_id": transcript.id},
    ).json()
    assert len(proposals) >= 4
    assert all(p["status"] == "pending" for p in proposals)
