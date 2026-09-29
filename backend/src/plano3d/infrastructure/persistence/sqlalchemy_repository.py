"""Repository sobre PostgreSQL (o SQLite en tests). El BuildingModel se guarda como JSON."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.application.ports import ProjectRepository
from plano3d.domain import Project, ProjectStatus

JsonType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_image_key: Mapped[str] = mapped_column(String(255))
    corners: Mapped[Any] = mapped_column(JsonType, nullable=True)
    model: Mapped[Any] = mapped_column(JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def _to_row(p: Project, row: ProjectRow | None = None) -> ProjectRow:
    row = row or ProjectRow(id=p.id)
    row.name = p.name
    row.status = p.status.value
    row.error = p.error
    row.original_image_key = p.original_image_key
    row.corners = [list(c) for c in p.corners] if p.corners else None
    row.model = model_to_dto(p.model).model_dump(mode="json") if p.model else None
    row.created_at = p.created_at
    row.updated_at = p.updated_at
    return row


def _to_domain(row: ProjectRow) -> Project:
    return Project(
        id=row.id,
        name=row.name,
        status=ProjectStatus(row.status),
        error=row.error,
        original_image_key=row.original_image_key,
        corners=[(float(x), float(y)) for x, y in row.corners] if row.corners else None,
        model=model_from_dto(BuildingModelDTO.model_validate(row.model)) if row.model else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class SqlAlchemyProjectRepository(ProjectRepository):
    def __init__(self, engine: AsyncEngine) -> None:
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def add(self, project: Project) -> None:
        async with self._sessions.begin() as s:
            s.add(_to_row(project))

    async def get(self, project_id: str) -> Project | None:
        async with self._sessions() as s:
            row = await s.get(ProjectRow, project_id)
            return _to_domain(row) if row else None

    async def list(self) -> list[Project]:
        async with self._sessions() as s:
            rows = (await s.scalars(select(ProjectRow))).all()
            return [_to_domain(r) for r in rows]

    async def save(self, project: Project) -> None:
        async with self._sessions.begin() as s:
            row = await s.get(ProjectRow, project.id)
            if row is None:
                raise KeyError(project.id)
            _to_row(project, row)

    async def delete(self, project_id: str) -> None:
        async with self._sessions.begin() as s:
            row = await s.get(ProjectRow, project_id)
            if row is not None:
                await s.delete(row)
