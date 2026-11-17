"""add public task/project ids and free-text Blocked by

Revision ID: c3f8a1d2e4b5
Revises: a1b2c3d4e5f6
Create Date: 2026-11-14 09:00:00.000000

Backfill is deterministic: records are numbered by ``(created_at, id)`` per
kind, and the per-kind counter rows are set to the highest assigned number so
new records continue the sequence without a ``max()+1`` race.

Legacy open task-linked ``Blocker`` rows are copied into ``tasks.blocked_by``
only when the task has no text there yet. Blocker rows are never modified or
deleted by this migration.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a1d2e4b5"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PUBLIC_ID_TABLES = (
    ("tasks", "TASK", "task"),
    ("projects", "PROJ", "project"),
)


def _backfill_public_ids(connection, table: str, prefix: str, kind: str) -> None:
    rows = (
        connection.execute(
            sa.text(f"SELECT id FROM {table} ORDER BY created_at ASC, id ASC")
        )
        .scalars()
        .all()
    )
    for number, record_id in enumerate(rows, start=1):
        connection.execute(
            sa.text(f"UPDATE {table} SET public_id = :public_id WHERE id = :record_id"),
            {"public_id": f"{prefix}-{number}", "record_id": record_id},
        )
    connection.execute(
        sa.text("UPDATE public_id_sequences SET last_value = :last WHERE kind = :kind"),
        {"last": len(rows), "kind": kind},
    )


def _migrate_open_blocker_descriptions(connection) -> None:
    rows = connection.execute(
        sa.text(
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
            sa.text("SELECT blocked_by FROM tasks WHERE id = :task_id"),
            {"task_id": task_id},
        ).scalar()
        if existing and existing.strip():
            continue
        connection.execute(
            sa.text("UPDATE tasks SET blocked_by = :blocked_by WHERE id = :task_id"),
            {"blocked_by": "; ".join(descriptions), "task_id": task_id},
        )


def upgrade() -> None:
    op.create_table(
        "public_id_sequences",
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("kind"),
    )
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO public_id_sequences (kind, last_value) "
            "VALUES ('task', 0), ('project', 0)"
        )
    )

    op.add_column("projects", sa.Column("public_id", sa.String(length=32), nullable=True))
    op.add_column("tasks", sa.Column("public_id", sa.String(length=32), nullable=True))
    op.add_column("tasks", sa.Column("blocked_by", sa.Text(), nullable=True))
    op.add_column("task_updates", sa.Column("blocked_by", sa.Text(), nullable=True))

    for table, prefix, kind in _PUBLIC_ID_TABLES:
        _backfill_public_ids(connection, table, prefix, kind)
    _migrate_open_blocker_descriptions(connection)

    # Enforce the invariant after the deterministic backfill. Batch mode keeps
    # this portable to SQLite, which cannot ALTER a column to NOT NULL in place.
    for table, _prefix, _kind in _PUBLIC_ID_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "public_id", existing_type=sa.String(length=32), nullable=False
            )
        op.create_index(
            f"ix_{table}_public_id", table, ["public_id"], unique=True
        )


def downgrade() -> None:
    for table, _prefix, _kind in _PUBLIC_ID_TABLES:
        op.drop_index(f"ix_{table}_public_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_column("public_id")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("blocked_by")
    with op.batch_alter_table("task_updates") as batch:
        batch.drop_column("blocked_by")
    op.drop_table("public_id_sequences")
