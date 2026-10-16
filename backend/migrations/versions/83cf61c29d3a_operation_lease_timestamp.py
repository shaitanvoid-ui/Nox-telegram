"""Track mutation attempts independently of case creation time.

Revision ID: 83cf61c29d3a
Revises: 7263c45a6450
"""

import sqlalchemy as sa
from alembic import op

revision = "83cf61c29d3a"
down_revision = "7263c45a6450"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("moderation_cases", sa.Column("operation_started_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE moderation_cases SET operation_started_at = created_at")
    with op.batch_alter_table("moderation_cases") as batch:
        batch.alter_column(
            "operation_started_at", existing_type=sa.DateTime(timezone=True), nullable=False
        )


def downgrade() -> None:
    with op.batch_alter_table("moderation_cases") as batch:
        batch.drop_column("operation_started_at")
