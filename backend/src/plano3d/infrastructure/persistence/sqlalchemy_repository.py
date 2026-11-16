"""Repository sobre PostgreSQL (o SQLite en tests). El BuildingModel se guarda como JSON."""

from __future__ import annotations

import builtins
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    delete,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.application.ports import ProjectRepository, UserRepository
from plano3d.application.use_cases.errors import EmailTakenError
from plano3d.domain import ModelRevision, Project, ProjectStatus
from plano3d.domain.errors import ConcurrencyError
from plano3d.domain.user import User

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
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    owner_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RevisionRow(Base):
    __tablename__ = "model_revisions"
    __table_args__ = (UniqueConstraint("project_id", "number", name="uq_revision_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(Text)
    model: Mapped[Any] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def _to_row(p: Project, row: ProjectRow | None = None) -> ProjectRow:
    row = row or ProjectRow(id=p.id)
    row.name = p.name
    row.status = p.status.value
    row.error = p.error
    row.original_image_key = p.original_image_key
    row.corners = [list(c) for c in p.corners] if p.corners else None
    row.model = model_to_dto(p.model).model_dump(mode="json") if p.model else None
    row.revision = p.revision
    row.owner_id = p.owner_id
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
        revision=row.revision or 0,
        owner_id=row.owner_id,
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

    async def save(self, project: Project, expected_revision: int | None = None) -> None:
        async with self._sessions.begin() as s:
            # FOR UPDATE: la comprobación de revisión y la escritura son atómicas en Postgres
            row = (
                await s.scalars(
                    select(ProjectRow).where(ProjectRow.id == project.id).with_for_update()
                )
            ).one_or_none()
            if row is None:
                raise KeyError(project.id)
            if expected_revision is not None and row.revision != expected_revision:
                raise ConcurrencyError(expected_revision, row.revision)
            _to_row(project, row)

    async def delete(self, project_id: str) -> None:
        async with self._sessions.begin() as s:
            await s.execute(delete(RevisionRow).where(RevisionRow.project_id == project_id))
            row = await s.get(ProjectRow, project_id)
            if row is not None:
                await s.delete(row)

    async def add_revision(self, revision: ModelRevision) -> None:
        async with self._sessions.begin() as s:
            s.add(
                RevisionRow(
                    project_id=revision.project_id,
                    number=revision.number,
                    summary=revision.summary,
                    model=model_to_dto(revision.model).model_dump(mode="json"),
                    created_at=revision.created_at,
                )
            )

    async def list_revisions(self, project_id: str) -> builtins.list[ModelRevision]:
        async with self._sessions() as s:
            rows = (
                await s.scalars(
                    select(RevisionRow)
                    .where(RevisionRow.project_id == project_id)
                    .order_by(RevisionRow.number.desc())
                )
            ).all()
            return [_revision(r) for r in rows]

    async def get_revision(self, project_id: str, number: int) -> ModelRevision | None:
        async with self._sessions() as s:
            row = (
                await s.scalars(
                    select(RevisionRow).where(
                        RevisionRow.project_id == project_id, RevisionRow.number == number
                    )
                )
            ).one_or_none()
            return _revision(row) if row else None


def _revision(r: RevisionRow) -> ModelRevision:
    return ModelRevision(
        project_id=r.project_id,
        number=r.number,
        summary=r.summary,
        model=model_from_dto(BuildingModelDTO.model_validate(r.model)),
        created_at=r.created_at,
    )


def _user_row(u: User, row: UserRow | None = None) -> UserRow:
    row = row or UserRow(id=u.id)
    row.email = u.email
    row.name = u.name
    row.password_hash = u.password_hash
    row.token_version = u.token_version
    row.is_demo = u.is_demo
    row.created_at = u.created_at
    return row


def _user(row: UserRow) -> User:
    return User(
        id=row.id,
        email=row.email,
        name=row.name,
        password_hash=row.password_hash,
        created_at=row.created_at,
        token_version=row.token_version or 0,
        is_demo=bool(row.is_demo),
    )


class SqlAlchemyUserRepository(UserRepository):
    def __init__(self, engine: AsyncEngine) -> None:
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def add(self, user: User) -> None:
        try:
            async with self._sessions.begin() as s:
                s.add(_user_row(user))
        except IntegrityError as exc:
            raise EmailTakenError() from exc

    async def get(self, user_id: str) -> User | None:
        async with self._sessions() as s:
            row = await s.get(UserRow, user_id)
            return _user(row) if row else None

    async def get_by_email(self, email: str) -> User | None:
        async with self._sessions() as s:
            row = (await s.scalars(select(UserRow).where(UserRow.email == email))).one_or_none()
            return _user(row) if row else None

    async def save(self, user: User) -> None:
        async with self._sessions.begin() as s:
            row = await s.get(UserRow, user.id)
            if row is None:
                raise KeyError(user.id)
            _user_row(user, row)

    async def list(self) -> builtins.list[User]:
        async with self._sessions() as s:
            return [_user(r) for r in (await s.scalars(select(UserRow))).all()]
