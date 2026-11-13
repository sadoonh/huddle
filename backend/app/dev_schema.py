"""SQLite-only development schema updater.

The production schema is owned by Alembic. Local demo databases may predate a
model change, and ``create_all`` cannot add columns to existing tables. This
script creates missing tables, adds missing (nullable) columns, creates missing
indexes, and then stamps the local database at the current Alembic head.

It never drops data. If a future required column cannot be added safely to a
non-empty SQLite table, it fails with instructions to reset the demo database.
"""

from __future__ import annotations

from contextlib import suppress
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.config import get_settings
from app.db import engine
from app.models import Base

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    settings = get_settings()
    if not settings.is_sqlite:
        raise SystemExit("dev_schema is SQLite-only; run 'alembic upgrade head'.")

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
                if not column.nullable:
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

    if added:
        print(f"Upgraded local SQLite schema: {', '.join(added)}")


if __name__ == "__main__":
    main()
