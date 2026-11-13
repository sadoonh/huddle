from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from datetime import date, timedelta

import pytest

_TEST_DIR = tempfile.mkdtemp(prefix="nex-standup-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR}/test.db"
os.environ["ENVIRONMENT"] = "test"
os.environ["AUTH_MODE"] = "dev"
os.environ["DEV_DEFAULT_USER_EMAIL"] = "manager@test.local"
os.environ["AI_PROVIDER"] = "mock"
os.environ["AI_PROCESSING_INLINE"] = "true"
os.environ["TRANSCRIPT_LOCAL_DIR"] = f"{_TEST_DIR}/transcripts"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.enums import (  # noqa: E402
    BlockerStatus,
    Priority,
    ProjectMemberRole,
    Role,
    TaskStatus,
)
from app.main import app  # noqa: E402
from app.models import Base, Blocker, Project, ProjectMember, Task, User  # noqa: E402
from app.schemas.standups import (  # noqa: E402
    MeetingActionItemCreate,
    ParticipantPatch,
    PreMeetingSubmit,
    ProgressCapture,
    SessionCreate,
)
from app.services import standups as standup_service  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture()
def db(fresh_db):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@dataclass
class Team:
    manager: User
    admin: User
    alice: User
    bob: User
    project: Project
    dashboard: Task
    overdue: Task
    at_risk: Task
    backlog: Task
    done: Task
    bob_task: Task
    open_blocker: Blocker

    def auth(self, who: str) -> dict[str, str]:
        return {"X-Dev-User": getattr(self, who).email}


@pytest.fixture()
def team(db: Session) -> Team:
    manager = User(
        email="manager@test.local", full_name="Maya Manager", role=Role.MANAGER,
        standup_eligible=False,
    )
    admin = User(
        email="admin@test.local", full_name="Alex Admin", role=Role.ADMIN,
        standup_eligible=False,
    )
    alice = User(email="alice@test.local", full_name="Alice Analyst", role=Role.EMPLOYEE)
    bob = User(email="bob@test.local", full_name="Bob Builder", role=Role.EMPLOYEE)
    db.add_all([manager, admin, alice, bob])
    db.flush()

    project = Project(name="Alpha", owner_id=manager.id)
    db.add(project)
    db.flush()
    for member in (alice, bob):
        db.add(ProjectMember(project_id=project.id, user_id=member.id, role=ProjectMemberRole.MEMBER))

    today = date.today()
    dashboard = Task(
        project_id=project.id, title="Alpha dashboard", assignee_id=alice.id,
        status=TaskStatus.IN_PROGRESS, priority=Priority.HIGH, due_date=today + timedelta(days=2),
        created_by_id=manager.id,
    )
    overdue = Task(
        project_id=project.id, title="Overdue reconciliation", assignee_id=alice.id,
        status=TaskStatus.TODO, priority=Priority.MEDIUM, due_date=today - timedelta(days=1),
        created_by_id=manager.id,
    )
    at_risk = Task(
        project_id=project.id, title="At risk model", assignee_id=alice.id,
        status=TaskStatus.IN_PROGRESS, priority=Priority.HIGH, due_date=today + timedelta(days=4),
        is_at_risk=True, at_risk_reason="Waiting on data access", created_by_id=manager.id,
    )
    backlog = Task(
        project_id=project.id, title="Backlog idea", assignee_id=alice.id,
        status=TaskStatus.BACKLOG, priority=Priority.LOW, created_by_id=manager.id,
    )
    done = Task(
        project_id=project.id, title="Finished task", assignee_id=alice.id,
        status=TaskStatus.DONE, priority=Priority.MEDIUM, due_date=today - timedelta(days=3),
        created_by_id=manager.id,
    )
    bob_task = Task(
        project_id=project.id, title="Bob task", assignee_id=bob.id,
        status=TaskStatus.IN_PROGRESS, priority=Priority.MEDIUM, created_by_id=manager.id,
    )
    db.add_all([dashboard, overdue, at_risk, backlog, done, bob_task])
    db.flush()

    open_blocker = Blocker(
        task_id=dashboard.id, project_id=project.id,
        description="Warehouse access missing for marketing schema",
        owner_id=bob.id, reported_by_id=manager.id, status=BlockerStatus.OPEN,
    )
    db.add(open_blocker)
    db.commit()

    return Team(
        manager=manager, admin=admin, alice=alice, bob=bob, project=project,
        dashboard=dashboard, overdue=overdue, at_risk=at_risk, backlog=backlog,
        done=done, bob_task=bob_task, open_blocker=open_blocker,
    )


@pytest.fixture()
def previous_standup(db: Session, team: Team) -> str:
    """A completed session yesterday with one open action item for Alice."""
    session = standup_service.create_session(
        db,
        team.manager,
        SessionCreate(
            session_date=date.today() - timedelta(days=1),
            participant_ids=[team.alice.id, team.bob.id],
        ),
    )
    standup_service.submit_pre_meeting(
        db,
        team.alice,
        session.id,
        team.alice.id,
        PreMeetingSubmit(
            progress="Prior update from Alice",
            next_steps="Validate the marketing schema",
        ),
    )
    standup_service.start_session(db, team.manager, session.id)
    standup_service.capture_progress(
        db,
        team.manager,
        session.id,
        ProgressCapture(
            task_id=team.dashboard.id,
            progress="Captured during yesterday's standup",
            attributed_to_user_id=team.alice.id,
        ),
    )
    standup_service.capture_action_item(
        db,
        team.manager,
        session.id,
        MeetingActionItemCreate(
            description="Alice to validate the marketing schema next week",
            owner_id=team.alice.id,
            task_id=team.dashboard.id,
        ),
    )
    for participant in (team.alice, team.bob):
        standup_service.patch_participant(
            db, team.manager, session.id, participant.id, ParticipantPatch(reviewed=True)
        )
    standup_service.complete_session(db, team.manager, session.id)
    db.commit()
    return session.id


@pytest.fixture()
def client(fresh_db) -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def today_session(client: TestClient, team: Team) -> dict:
    response = client.post(
        "/api/v1/standups/sessions",
        headers=team.auth("manager"),
        json={
            "session_date": str(date.today()),
            "participant_ids": [team.alice.id, team.bob.id],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()
