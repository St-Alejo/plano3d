"""Códigos para compartir un proyecto con otra app (ADR-024).

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_shares",
        sa.Column("code", sa.String(16), primary_key=True),
        sa.Column("project_id", sa.String(40), nullable=False),
        sa.Column("owner_id", sa.String(40), nullable=True),
        sa.Column("app", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_project_shares_project_id", "project_shares", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_shares_project_id", table_name="project_shares")
    op.drop_table("project_shares")
