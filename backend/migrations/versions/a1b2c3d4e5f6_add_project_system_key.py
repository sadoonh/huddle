"""add project system key (Ad hoc designation)

Revision ID: a1b2c3d4e5f6
Revises: 643332b4ff0b
Create Date: 2026-11-13 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = 'e22f9953f1f1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('system_key', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_projects_system_key'), 'projects', ['system_key'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_projects_system_key'), table_name='projects')
    op.drop_column('projects', 'system_key')
