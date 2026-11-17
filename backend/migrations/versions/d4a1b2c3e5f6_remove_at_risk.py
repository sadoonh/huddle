"""remove at-risk task fields

Revision ID: d4a1b2c3e5f6
Revises: c3f8a1d2e4b5
Create Date: 2026-11-17 09:00:00.000000

At-risk tracking is retired from the product. The columns are removed so the
backend can no longer read or write them; no other task data is touched.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4a1b2c3e5f6"
down_revision: str | None = "c3f8a1d2e4b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("is_at_risk")
        batch.drop_column("at_risk_reason")


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(
            sa.Column("is_at_risk", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("at_risk_reason", sa.Text(), nullable=True))
