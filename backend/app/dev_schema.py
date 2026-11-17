"""SQLite-only development schema updater.

The production schema is owned by Alembic. Local demo databases may predate a
model change, and ``create_all`` cannot add columns to existing tables. This
script creates missing tables, adds missing (nullable) columns, creates missing
indexes, and then stamps the local database at the current Alembic head.

It never drops data. Required columns that can be backfilled safely
(``public_id``) are added as nullable, backfilled deterministically, and
uniquely indexed; repeat startups never reassign existing ids or overwrite
existing blocked-by text. Any other required column fails with instructions to
reset the demo database.
"""

from __future__ import annotations

from contextlib import suppress
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.config import get_settings
from app.core.legacy_backfill import backfill_public_ids, migrate_open_blocker_text
from app.db import engine
from app.models import Base

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# Required columns the local updater can add safely because a deterministic
# backfill runs immediately afterwards (SQLite keeps them nullable physically).
_BACKFILLABLE_REQUIRED_COLUMNS = {"public_id"}

# Columns that were removed from the product. Local databases may still carry
# them from older builds; dropping them keeps inserts (which no longer supply a
# value) valid and prevents dead NOT NULL columns from blocking startup.
_OBSOLETE_COLUMNS = {
    "tasks": ("is_at_risk", "at_risk_reason"),
}


def upgrade_database(engine, settings) -> list[str]:
    """Add missing schema, run non-destructive backfills, stamp the Alembic head."""
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                if not column.nullable and column.name not in _BACKFILLABLE_REQUIRED_COLUMNS:
                    raise SystemExit(
                        f"Cannot add required column {table.name}.{column.name} to an "
                        "existing local database. Run RESET=1 ./start.sh to rebuild demo data."
                    )
                type_sql = column.type.compile(dialect=engine.dialect)
                connection.execute(
                    text(
                        f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {type_sql}'
                    )
                )
                added.append(f"{table.name}.{column.name}")

        for table_name, columns in _OBSOLETE_COLUMNS.items():
            if table_name not in existing_tables:
                continue
            present = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name in columns:
                if column_name not in present:
                    continue
                connection.execute(
                    text(f'ALTER TABLE "{table_name}" DROP COLUMN "{column_name}"')
                )
                added.append(f"{table_name}.{column_name} (removed)")

        # Idempotent: only NULL ids are numbered, only empty blocked-by text is
        # migrated from legacy open blockers.
        backfill_public_ids(connection)
        migrate_open_blocker_text(connection)

    # Indexes for newly added columns, and any other missing declared index.
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            # A duplicate/corrupt local index should not block startup; the
            # model columns still work and the user can RESET the demo data.
            with suppress(Exception):
                index.create(bind=engine, checkfirst=True)

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    command.stamp(config, "head")

    return added


def main() -> None:
    settings = get_settings()
    if not settings.is_sqlite:
        raise SystemExit("dev_schema is SQLite-only; run 'alembic upgrade head'.")

    added = upgrade_database(engine, settings)

    if added:
        print(f"Upgraded local SQLite schema: {', '.join(added)}")


if __name__ == "__main__":
    main()
