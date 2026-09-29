"""El repositorio SQLAlchemy contra SQLite (siempre) y Postgres (marcador integration)."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from plano3d.domain import BuildingModel, Level, Point2D, Project, Room, Scale, Wall
from plano3d.infrastructure.persistence.sqlalchemy_repository import (
    Base,
    SqlAlchemyProjectRepository,
)


async def _engine(url: str) -> AsyncEngine:
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    return engine


@pytest.fixture(params=["sqlite"])
async def repo(request: pytest.FixtureRequest) -> AsyncIterator[SqlAlchemyProjectRepository]:
    engine = await _engine("sqlite+aiosqlite:///:memory:")
    yield SqlAlchemyProjectRepository(engine)
    await engine.dispose()


def _model(pid: str) -> BuildingModel:
    room = Room("r", "sala", (Point2D(0, 0), Point2D(3, 0), Point2D(3, 3), Point2D(0, 3)), 0.7)
    wall = Wall("w", Point2D(0, 0), Point2D(3, 0))
    return BuildingModel(pid, Scale(0.02), (Level("l0", "PB", walls=(wall,), rooms=(room,)),))


async def _exercise(repo: SqlAlchemyProjectRepository) -> None:
    p = Project.create("Casa", "originals/a.jpg", [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)])
    await repo.add(p)
    loaded = await repo.get(p.id)
    assert loaded is not None and loaded.name == "Casa" and loaded.corners == p.corners

    loaded.start_processing()
    loaded.complete(_model(p.id))
    await repo.save(loaded)
    again = await repo.get(p.id)
    assert again is not None and again.model == loaded.model
    assert again.status == loaded.status

    assert [x.id for x in await repo.list()] == [p.id]
    await repo.delete(p.id)
    assert await repo.get(p.id) is None
    with pytest.raises(KeyError):
        await repo.save(loaded)


async def test_sqlite_round_trip(repo: SqlAlchemyProjectRepository) -> None:
    await _exercise(repo)


@pytest.mark.integration
async def test_postgres_round_trip() -> None:
    url = os.environ.get(
        "PLANO3D_DATABASE_URL", "postgresql+asyncpg://plano3d:plano3d@localhost:5432/plano3d_test"
    )
    engine = await _engine(url)
    try:
        await _exercise(SqlAlchemyProjectRepository(engine))
    finally:
        await engine.dispose()
