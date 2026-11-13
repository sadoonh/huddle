"""Seed a realistic analytics-team workspace.

Usage:
    python -m app.seed --reset

The dataset deliberately includes open blockers and action items from previous
standups so carry-forward is visible the first time the workspace opens.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.db import SessionLocal, engine, init_db
from app.enums import BlockerStatus, IntakeStatus, Priority, TaskStatus
from app.models import Base, Blocker, StandupSession, Task, User
from app.schemas.intake import IntakeCreate, IntakePatch
from app.schemas.projects import ProjectCreate
from app.schemas.standups import (
    MeetingActionItemCreate,
    MeetingDecisionCreate,
    ParticipantPatch,
    PreMeetingSubmit,
    PreMeetingTaskUpdate,
    ProgressCapture,
    SessionCreate,
)
from app.schemas.tasks import BlockerCreate, TaskCreate, TaskPatch
from app.services import intake as intake_service
from app.services import projects as project_service
from app.services import standups as standup_service
from app.services.tasks import create_blocker, create_task, patch_task

TODAY = date.today()


def _backdate(obj, days: int, hour: int = 9) -> None:
    stamp = datetime.combine(TODAY - timedelta(days=days), datetime.min.time()).replace(
        hour=hour
    )
    if hasattr(obj, "created_at"):
        obj.created_at = stamp
    if hasattr(obj, "updated_at"):
        obj.updated_at = stamp


def _ensure_user(db, email: str, name: str, role, eligible: bool = True) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        return user
    user = User(email=email, full_name=name, role=role, standup_eligible=eligible)
    db.add(user)
    db.flush()
    return user


def seed(reset: bool = False) -> None:
    if reset:
        Base.metadata.drop_all(bind=engine)
    init_db()

    db = SessionLocal()
    try:
        if db.scalar(select(User).limit(1)) and not reset:
            print("Database already contains data. Use --reset to rebuild the demo workspace.")
            return

        # -- People --------------------------------------------------------
        manager = _ensure_user(db, "manager@nex.local", "Maya Chen", "manager", False)
        admin = _ensure_user(db, "admin@nex.local", "Alex Rivera", "admin", False)
        priya = _ensure_user(db, "priya@nex.local", "Priya Patel", "employee")
        jordan = _ensure_user(db, "jordan@nex.local", "Jordan Lee", "employee")
        sam = _ensure_user(db, "sam@nex.local", "Sam Okafor", "employee")
        dana = _ensure_user(db, "dana@nex.local", "Dana Kim", "employee")
        db.flush()

        # -- Projects ------------------------------------------------------
        revenue = project_service.create_project(
            db,
            manager,
            ProjectCreate(
                name="Revenue Reporting",
                description="Executive revenue reporting, variance analysis and board packs.",
                owner_id=manager.id,
                member_ids=[priya.id, jordan.id],
            ),
        )
        customer = project_service.create_project(
            db,
            manager,
            ProjectCreate(
                name="Customer Analytics Platform",
                description="Customer event model, churn and retention analytics.",
                owner_id=manager.id,
                member_ids=[sam.id, jordan.id],
            ),
        )
        marketing = project_service.create_project(
            db,
            manager,
            ProjectCreate(
                name="Marketing Attribution",
                description="Attribution modelling and channel performance reporting.",
                owner_id=manager.id,
                member_ids=[priya.id, dana.id],
            ),
        )
        quality = project_service.create_project(
            db,
            manager,
            ProjectCreate(
                name="Data Quality",
                description="Schema monitoring, null checks and duplicate detection.",
                owner_id=manager.id,
                member_ids=[jordan.id, sam.id],
            ),
        )

        def task(
            project,
            title,
            assignee,
            status=TaskStatus.TODO,
            priority=Priority.MEDIUM,
            due_in: int | None = None,
            at_risk: bool = False,
            reason: str | None = None,
            description: str | None = None,
        ) -> Task:
            created = create_task(
                db,
                manager,
                TaskCreate(
                    project_id=project.id,
                    title=title,
                    description=description,
                    assignee_id=assignee.id,
                    priority=priority,
                    status=TaskStatus.TODO,
                    due_date=TODAY + timedelta(days=due_in) if due_in is not None else None,
                ),
            )
            changes = {}
            if status != TaskStatus.TODO:
                changes["status"] = status
            if at_risk:
                changes["is_at_risk"] = True
                changes["at_risk_reason"] = reason
            if changes:
                patch_task(db, manager, created.id, TaskPatch(**changes))
            return created

        revenue_dashboard = task(
            revenue, "Revenue variance dashboard", priya, TaskStatus.IN_PROGRESS, Priority.HIGH, 2,
            description="Variance decomposition by product and region for the monthly close.",
        )
        q4_recon = task(
            revenue, "Q4 revenue reconciliation", priya, TaskStatus.TODO, Priority.MEDIUM, -1,
            description="Reconcile billing system totals against the finance ledger.",
        )
        board_pack = task(
            revenue, "Board pack revenue commentary", priya, TaskStatus.TODO, Priority.LOW, 5
        )
        pipeline = task(
            revenue, "Revenue pipeline refresh", jordan, TaskStatus.IN_PROGRESS, Priority.MEDIUM, 1
        )

        churn_backfill = task(
            customer, "Churn feature backfill", sam, TaskStatus.IN_PROGRESS, Priority.HIGH, 3,
            at_risk=True, reason="Backfill window overlaps the event schema migration.",
        )
        cohort_model = task(
            customer, "Cohort retention model", sam, TaskStatus.BACKLOG, Priority.MEDIUM, 10
        )
        event_migration = task(
            customer, "Event schema migration", jordan, TaskStatus.IN_PROGRESS, Priority.URGENT, -2,
            at_risk=True, reason="Blocked on vendor API credentials and already past due.",
        )
        segment_api = task(
            customer, "Segment export API", jordan, TaskStatus.TODO, Priority.MEDIUM, None
        )

        attribution_v2 = task(
            marketing, "Attribution model v2", priya, TaskStatus.IN_PROGRESS, Priority.HIGH, 4,
            at_risk=True, reason="Waiting on warehouse access to the marketing schema.",
        )
        channel_ingest = task(
            marketing, "Channel spend ingest", priya, TaskStatus.TODO, Priority.MEDIUM, 6
        )
        taxonomy = task(
            marketing, "Campaign taxonomy cleanup", dana, TaskStatus.IN_PROGRESS, Priority.MEDIUM, -1,
            at_risk=True, reason="Taxonomy sign-off pending with the marketing team.",
        )
        looker_dashboard = task(
            marketing, "Looker attribution dashboard", dana, TaskStatus.TODO, Priority.HIGH, 2
        )

        null_checks = task(
            quality, "Null checks on orders", jordan, TaskStatus.IN_PROGRESS, Priority.HIGH, 1
        )
        duplicates = task(
            quality, "Duplicate customer detection", sam, TaskStatus.TODO, Priority.MEDIUM, 7
        )
        drift = task(
            quality, "Schema drift alerting", sam, TaskStatus.BACKLOG, Priority.LOW, None
        )

        task(revenue, "Publish weekly KPI digest", priya, TaskStatus.DONE, Priority.MEDIUM, -2)
        task(quality, "Fix currency conversion bug", sam, TaskStatus.DONE, Priority.HIGH, -3)
        task(marketing, "Migrate legacy attribution sheet", dana, TaskStatus.CANCELED, Priority.LOW, None)
        db.flush()

        # -- Open blockers and action items that must carry forward --------
        warehouse_blocker = create_blocker(
            db,
            manager,
            BlockerCreate(
                description="Warehouse access missing for the marketing schema; model v2 cannot be validated.",
                task_id=attribution_v2.id,
                owner_id=jordan.id,
            ),
        )
        _backdate(warehouse_blocker, 3)

        api_key_blocker = create_blocker(
            db,
            manager,
            BlockerCreate(
                description="Event schema migration is waiting on the vendor API key from procurement.",
                task_id=event_migration.id,
                owner_id=sam.id,
            ),
        )
        _backdate(api_key_blocker, 2)

        looker_blocker = create_blocker(
            db,
            manager,
            BlockerCreate(
                description="Looker service account expired, blocking dashboard publishing.",
                task_id=looker_dashboard.id,
                owner_id=dana.id,
            ),
        )
        _backdate(looker_blocker, 3)

        taxonomy_blocker = create_blocker(
            db,
            manager,
            BlockerCreate(
                description="Campaign taxonomy sign-off is pending with the marketing team.",
                task_id=taxonomy.id,
                owner_id=manager.id,
            ),
        )
        _backdate(taxonomy_blocker, 1)

        # -- Historical standups ------------------------------------------
        sessions = _seed_sessions(
            db,
            manager,
            participants=[priya, jordan, dana],
            revenue_dashboard=revenue_dashboard,
            q4_recon=q4_recon,
            attribution_v2=attribution_v2,
            taxonomy=taxonomy,
            looker_dashboard=looker_dashboard,
        )
        # Link pre-existing blockers to the session where they were first
        # discussed so historical review can answer "when did this start?".
        for model, session in (
            (warehouse_blocker, sessions[0]),
            (looker_blocker, sessions[0]),
            (api_key_blocker, sessions[1]),
            (taxonomy_blocker, sessions[2]),
        ):
            record = db.get(Blocker, model.id)
            if record:
                record.reported_session_id = session.id
        db.flush()

        # -- Intake --------------------------------------------------------
        req1 = intake_service.create_request(
            db,
            priya,
            IntakeCreate(
                title="Add weekly active users by plan to the exec dashboard",
                description="Exec team asked for WAU split by pricing plan in the weekly digest.",
                priority=Priority.HIGH,
            ),
        )
        req2 = intake_service.create_request(
            db,
            dana,
            IntakeCreate(
                title="Export attribution data to Snowflake",
                description="Marketing wants attribution outputs landed in the shared Snowflake schema.",
                priority=Priority.MEDIUM,
            ),
        )
        intake_service.patch_request(
            db,
            manager,
            req2.id,
            IntakePatch(status=IntakeStatus.UNDER_REVIEW, review_note="Needs a cost estimate first."),
        )
        intake_service.create_request(
            db,
            jordan,
            IntakeCreate(
                title="Automate the monthly revenue deck",
                description="Replace the manual slide refresh with a scheduled notebook export.",
                priority=Priority.LOW,
            ),
        )

        db.commit()
        print("Seed complete.")
        print("  users:    manager@nex.local (Maya), priya@, jordan@, sam@, dana@")
        print(f"  projects: {revenue.name}, {customer.name}, {marketing.name}, {quality.name}")
        print(f"  sessions: {', '.join(s.session_date.isoformat() for s in sessions)}")
        print("  open carry-forward: warehouse access (3d), vendor API key (2d), taxonomy sign-off (1d)")
        print("  no session exists for today yet — open the app as manager to start it.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _seed_sessions(
    db,
    manager: User,
    *,
    participants: list[User],
    revenue_dashboard: Task,
    q4_recon: Task,
    attribution_v2: Task,
    taxonomy: Task,
    looker_dashboard: Task,
) -> list[StandupSession]:
    priya, jordan, dana = participants
    sessions: list[StandupSession] = []

    # --- Three days ago ---------------------------------------------------
    s1 = standup_service.create_session(
        db,
        manager,
        SessionCreate(
            session_date=TODAY - timedelta(days=3),
            participant_ids=[priya.id, jordan.id, dana.id],
        ),
    )
    _backdate_session(db, s1.id, 3)
    standup_service.submit_pre_meeting(
        db,
        priya,
        s1.id,
        priya.id,
        PreMeetingSubmit(
            progress="Finished the first pass of the revenue variance dashboard.",
            next_steps="Validate Q4 numbers against finance.",
            blockers="I still cannot query the marketing schema.",
            task_updates=[
                PreMeetingTaskUpdate(
                    task_id=revenue_dashboard.id,
                    progress="Variance decomposition is wired up for product and region.",
                    next_steps="Validate Q4 totals with finance.",
                )
            ],
        ),
    )
    standup_service.submit_pre_meeting(
        db,
        jordan,
        s1.id,
        jordan.id,
        PreMeetingSubmit(
            progress="Event schema migration is half complete.",
            next_steps="Finish the backfill once the vendor key arrives.",
        ),
    )
    standup_service.submit_pre_meeting(
        db,
        dana,
        s1.id,
        dana.id,
        PreMeetingSubmit(
            progress="Campaign taxonomy audit is complete; sign-off is pending.",
            next_steps="Get marketing sign-off.",
        ),
    )
    standup_service.start_session(db, manager, s1.id)
    standup_service.capture_progress(
        db,
        manager,
        s1.id,
        ProgressCapture(
            task_id=revenue_dashboard.id,
            progress="Dashboard renders v1; reconciling against the finance ledger next.",
            next_steps="Reconcile Q4 revenue totals.",
            attributed_to_user_id=priya.id,
        ),
    )
    standup_service.capture_action_item(
        db,
        manager,
        s1.id,
        MeetingActionItemCreate(
            description="Jordan to request marketing schema access from the platform team.",
            owner_id=jordan.id,
            task_id=attribution_v2.id,
            due_date=TODAY - timedelta(days=1),
        ),
    )
    standup_service.capture_decision(
        db,
        manager,
        s1.id,
        MeetingDecisionCreate(
            description="Prioritise the event schema migration before new attribution work.",
            task_id=attribution_v2.id,
            rationale="Downstream churn and attribution models both depend on the new event model.",
        ),
    )
    _complete(db, manager, s1.id, participants)
    sessions.append(s1)

    # --- Two days ago -----------------------------------------------------
    s2 = standup_service.create_session(
        db,
        manager,
        SessionCreate(
            session_date=TODAY - timedelta(days=2),
            participant_ids=[priya.id, jordan.id, dana.id],
        ),
    )
    _backdate_session(db, s2.id, 2)
    standup_service.start_session(db, manager, s2.id)
    standup_service.capture_progress(
        db,
        manager,
        s2.id,
        ProgressCapture(
            task_id=q4_recon.id,
            progress="Started reconciling Q4; three billing edge cases remain.",
            next_steps="Resolve edge cases with finance by Thursday.",
            attributed_to_user_id=priya.id,
        ),
    )
    standup_service.capture_decision(
        db,
        manager,
        s2.id,
        MeetingDecisionCreate(
            description="Attribution launch moves to next month.",
            project_id=attribution_v2.project_id,
            rationale="Model validation cannot finish while schema access is blocked.",
            responsible_user_id=manager.id,
        ),
    )
    standup_service.capture_action_item(
        db,
        manager,
        s2.id,
        MeetingActionItemCreate(
            description="Dana to confirm the campaign taxonomy with marketing.",
            owner_id=dana.id,
            task_id=taxonomy.id,
            due_date=TODAY + timedelta(days=1),
        ),
    )
    resolved = standup_service.resolve_blocker_in_session(
        db,
        manager,
        s2.id,
        _first_open_blocker_id(db, looker_dashboard.id),
        "Service account rotated; dashboard publishing unblocked.",
    )
    resolved_record = db.get(Blocker, resolved.id)
    if resolved_record:
        resolved_record.resolved_at = datetime.combine(
            TODAY - timedelta(days=2), datetime.min.time()
        ).replace(hour=10)
    _complete(db, manager, s2.id, participants)
    sessions.append(s2)

    # --- Yesterday --------------------------------------------------------
    s3 = standup_service.create_session(
        db,
        manager,
        SessionCreate(
            session_date=TODAY - timedelta(days=1),
            participant_ids=[priya.id, jordan.id, dana.id],
        ),
    )
    _backdate_session(db, s3.id, 1)
    standup_service.submit_pre_meeting(
        db,
        priya,
        s3.id,
        priya.id,
        PreMeetingSubmit(
            progress="Q4 reconciliation is down to one billing edge case.",
            next_steps="Close the remaining edge case and hand off to finance.",
            blockers="Marketing schema access is still missing.",
        ),
    )
    standup_service.start_session(db, manager, s3.id)
    standup_service.capture_progress(
        db,
        manager,
        s3.id,
        ProgressCapture(
            task_id=attribution_v2.id,
            progress="Model v2 specification is ready but cannot be validated without schema access.",
            next_steps="Run validation as soon as access is granted.",
            attributed_to_user_id=priya.id,
        ),
    )
    standup_service.capture_decision(
        db,
        manager,
        s3.id,
        MeetingDecisionCreate(
            description="Event schema migration remains the top priority this sprint.",
            task_id=attribution_v2.id,
            rationale="It unblocks three downstream workstreams.",
        ),
    )
    _complete(db, manager, s3.id, participants)
    sessions.append(s3)
    return sessions


def _first_open_blocker_id(db, task_id: str) -> str:
    blocker = db.scalar(
        select(Blocker).where(
            Blocker.task_id == task_id, Blocker.status == BlockerStatus.OPEN
        )
    )
    if blocker is None:
        raise RuntimeError("Seed blocker missing")
    return blocker.id


def _backdate_session(db, session_id: str, days: int) -> None:
    session = db.get(StandupSession, session_id)
    if session is None:
        return
    start = datetime.combine(TODAY - timedelta(days=days), datetime.min.time()).replace(hour=9, minute=30)
    session.created_at = start
    session.updated_at = start
    for participant in session.participants:
        participant.created_at = start
        participant.updated_at = start
    db.flush()


def _complete(db, manager: User, session_id: str, participants: list[User]) -> None:
    for participant in participants:
        standup_service.patch_participant(
            db,
            manager,
            session_id,
            participant.id,
            ParticipantPatch(reviewed=True),
        )
    standup_service.complete_session(db, manager, session_id, force=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the nex standup workspace")
    parser.add_argument("--reset", action="store_true", help="drop and rebuild all tables")
    args = parser.parse_args()
    seed(reset=args.reset)


if __name__ == "__main__":
    main()
