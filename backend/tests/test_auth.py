from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_and_me(client: TestClient, team):
    assert client.get("/health").json()["status"] == "ok"
    response = client.get("/api/v1/me", headers=team.auth("manager"))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "manager@test.local"
    assert body["is_manager"] is True


def test_unknown_dev_identity_is_rejected(client: TestClient):
    response = client.get("/api/v1/me", headers={"X-Dev-User": "nobody@test.local"})
    assert response.status_code == 401


def test_dev_default_identity_provisions_manager(client: TestClient):
    # No users in this test: the default dev identity is provisioned.
    response = client.get("/api/v1/me")
    assert response.status_code == 200
    assert response.json()["role"] == "manager"


def test_nex_header_mode_provisions_and_elevates(client: TestClient, monkeypatch):
    import app.core.security as security
    from app.config import Settings

    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: Settings(
            auth_mode="nex",
            environment="test",
            nex_user_header="X-Nex-User-Id",
            nex_email_header="X-Nex-Email",
            nex_name_header="X-Nex-Name",
            nex_roles_header="X-Nex-Roles",
        ),
    )
    headers = {
        "X-Nex-User-Id": "sso-123",
        "X-Nex-Email": "New.Person@Corp.Example",
        "X-Nex-Name": "New Person",
        "X-Nex-Roles": "employee,nex-manager",
    }
    response = client.get("/api/v1/me", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "manager"
    assert body["email"] == "new.person@corp.example"

    # A later login without the manager role must not silently demote.
    headers["X-Nex-Roles"] = "employee"
    again = client.get("/api/v1/me", headers=headers).json()
    assert again["role"] == "manager"


def test_nex_mode_requires_headers(client: TestClient, monkeypatch):
    import app.core.security as security
    from app.config import Settings

    monkeypatch.setattr(
        security, "get_settings", lambda: Settings(auth_mode="nex", environment="test")
    )
    assert client.get("/api/v1/me").status_code == 401
