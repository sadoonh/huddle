from __future__ import annotations

from fastapi.testclient import TestClient


def test_retired_api_surfaces_are_not_registered(client: TestClient, team):
    manager = team.auth("manager")
    assert client.get("/api/v1/ai/transcripts", headers=manager).status_code == 404
    assert client.post("/api/v1/ai/transcripts", headers=manager, json={}).status_code == 404
    assert client.get("/api/v1/intake", headers=manager).status_code == 404
    assert client.post("/api/v1/intake", headers=manager, json={}).status_code == 404

    # Past-standup/history endpoints are no longer registered. (GET on the
    # session collection collides with the POST create route, so it is 405.)
    assert client.get("/api/v1/standups/sessions", headers=manager).status_code != 200
    for path in (
        "/api/v1/standups/sessions/x/outcomes",
        "/api/v1/standups/sessions/x/captures",
        "/api/v1/standups/sessions/x/timeline",
        "/api/v1/standups/users/x/history",
        "/api/v1/standups/users/x/carry-forward",
    ):
        assert client.get(path, headers=manager).status_code == 404


def test_active_api_surface_still_serves_tasks_and_projects(client: TestClient, team):
    manager = team.auth("manager")
    assert client.get("/api/v1/tasks", headers=manager).status_code == 200
    projects = client.get("/api/v1/projects", headers=manager).json()
    assert any(project["system_key"] == "ad_hoc" for project in projects)
