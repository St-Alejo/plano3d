"""Revisiones del modelo y bloqueo optimista.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "projects", sa.Column("revision", sa.Integer(), nullable=False, server_default="0")
    )
    op.create_table(
        "model_revisions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "project_id",
            sa.String(40),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("model", JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "number", name="uq_revision_number"),
    )
    op.create_index("ix_model_revisions_project_id", "model_revisions", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_model_revisions_project_id", table_name="model_revisions")
    op.drop_table("model_revisions")
    op.drop_column("projects", "revision")
