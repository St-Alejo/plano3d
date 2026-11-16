"""Cuentas de usuario y dueño de cada proyecto (ADR-020).

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column("projects", sa.Column("owner_id", sa.String(40), nullable=True))
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_projects_owner_id", table_name="projects")
    op.drop_column("projects", "owner_id")
    op.drop_table("users")
