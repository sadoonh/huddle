"""Non-destructive backfills shared by the local SQLite schema updater.

The production path is Alembic; these helpers exist so an existing local demo
database can gain the required human-readable ids (and the migrated
``tasks.blocked_by`` text) without a reset. They are idempotent: existing ids
and existing blocked-by text are never overwritten, and running them again on
the next startup is a no-op.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

_PUBLIC_ID_TARGETS = (
    ("tasks", "TASK", "task"),
    ("projects", "PROJ", "project"),
)

_SEQUENCE_TABLE = "public_id_sequences"


def _public_id_number(public_id: str | None) -> int:
    if not public_id:
        return 0
    _prefix, _sep, suffix = public_id.rpartition("-")
    try:
        return int(suffix)
    except ValueError:
        return 0


def _ensure_sequence_row(connection: Connection, kind: str) -> None:
    connection.execute(
        text(
            f"INSERT INTO {_SEQUENCE_TABLE} (kind, last_value) "
            "SELECT :kind, 0 WHERE NOT EXISTS "
            f"(SELECT 1 FROM {_SEQUENCE_TABLE} WHERE kind = :kind)"
        ),
        {"kind": kind},
    )


def backfill_public_ids(connection: Connection) -> None:
    """Assign TASK-/PROJ- ids to rows that have none, continuing the sequence."""
    for table, prefix, kind in _PUBLIC_ID_TARGETS:
        _ensure_sequence_row(connection, kind)
        existing = connection.execute(
            text(f"SELECT public_id FROM {table} WHERE public_id IS NOT NULL")
        ).scalars()
        highest_existing = max((_public_id_number(value) for value in existing), default=0)
        counter = connection.execute(
            text(f"SELECT last_value FROM {_SEQUENCE_TABLE} WHERE kind = :kind"),
            {"kind": kind},
        ).scalar_one()
        next_value = max(highest_existing, counter or 0)

        missing = (
            connection.execute(
                text(
                    f"SELECT id FROM {table} WHERE public_id IS NULL "
                    "ORDER BY created_at ASC, id ASC"
                )
            )
            .scalars()
            .all()
        )
        for record_id in missing:
            next_value += 1
            connection.execute(
                text(
                    f"UPDATE {table} SET public_id = :public_id WHERE id = :record_id"
                ),
                {"public_id": f"{prefix}-{next_value}", "record_id": record_id},
            )
        connection.execute(
            text(f"UPDATE {_SEQUENCE_TABLE} SET last_value = :last WHERE kind = :kind"),
            {"last": next_value, "kind": kind},
        )


def migrate_open_blocker_text(connection: Connection) -> None:
    """Copy open task-linked blocker descriptions into empty ``blocked_by`` text.

    Legacy blocker rows are preserved untouched. Tasks that already have
    text are skipped, so repeat startups cannot overwrite a curated value.
    """
    rows = connection.execute(
        text(
            """
            SELECT b.task_id, b.description
            FROM blockers b
            JOIN tasks t ON t.id = b.task_id
            WHERE b.status = 'open'
            ORDER BY b.task_id ASC, b.created_at ASC, b.id ASC
            """
        )
    ).all()
    grouped: dict[str, list[str]] = {}
    for task_id, description in rows:
        if description and description.strip():
            grouped.setdefault(task_id, []).append(description.strip())
    for task_id, descriptions in grouped.items():
        existing = connection.execute(
            text("SELECT blocked_by FROM tasks WHERE id = :task_id"),
            {"task_id": task_id},
        ).scalar_one_or_none()
        if existing and existing.strip():
            continue
        connection.execute(
            text("UPDATE tasks SET blocked_by = :blocked_by WHERE id = :task_id"),
            {"blocked_by": "; ".join(descriptions), "task_id": task_id},
        )
