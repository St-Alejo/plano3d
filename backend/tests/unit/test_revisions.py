"""Historial de versiones, bloqueo optimista y tasa de corrección (casos de uso)."""

from __future__ import annotations

import pytest

from plano3d.application.use_cases.analyze import AnalyzeFloorPlan, DetectorSelector
from plano3d.application.use_cases.projects import (
    CalibrateScale,
    CreateProject,
    GetCorrectionStats,
    ListRevisions,
    RestoreRevision,
    UpdateBuildingModel,
)
from plano3d.domain import Point2D
from plano3d.domain.errors import ConcurrencyError, DomainError, EntityNotFoundError
from plano3d.infrastructure.memory import (
    InMemoryFileStorage,
    InMemoryProgressBroker,
    InMemoryProjectRepository,
)
from tests.unit.test_use_cases import FakeDetector, FakeInspector, RecordingQueue


@pytest.fixture
async def ready() -> tuple[InMemoryProjectRepository, str]:
    repo, storage, queue = InMemoryProjectRepository(), InMemoryFileStorage(), RecordingQueue()
    pid = (await CreateProject(repo, storage, queue).execute("Casa", b"x", "image/jpeg")).id
    selector = DetectorSelector([FakeDetector()], FakeInspector())
    await AnalyzeFloorPlan(repo, storage, selector, InMemoryProgressBroker()).execute(pid)
    return repo, pid


async def test_detection_creates_revision_1(ready) -> None:  # type: ignore[no-untyped-def]
    repo, pid = ready
    project = await repo.get(pid)
    assert project is not None and project.revision == 1
    revs = await ListRevisions(repo).execute(pid)
    assert [r.number for r in revs] == [1]
    assert revs[0].summary.startswith("Detección automática")


async def test_each_save_is_a_new_revision_newest_first(ready) -> None:  # type: ignore[no-untyped-def]
    repo, pid = ready
    model = (await repo.get(pid)).model  # type: ignore[union-attr]
    await UpdateBuildingModel(repo).execute(
        pid, model, expected_revision=1, summary="Ajuste de muros"
    )
    await CalibrateScale(repo).execute(pid, Point2D(0, 0), Point2D(400, 0), 8.0)
    revs = await ListRevisions(repo).execute(pid)
    assert [(r.number, r.summary) for r in revs] == [
        (3, "Calibración de escala (8.00 m)"),
        (2, "Ajuste de muros"),
        (1, "Detección automática (classic-cv)"),
    ]


async def test_stale_revision_is_rejected_and_nothing_changes(ready) -> None:  # type: ignore[no-untyped-def]
    repo, pid = ready
    model = (await repo.get(pid)).model  # type: ignore[union-attr]
    await UpdateBuildingModel(repo).execute(pid, model, expected_revision=1)
    # otra persona tenía abierta la revisión 1
    with pytest.raises(ConcurrencyError) as info:
        await UpdateBuildingModel(repo).execute(pid, model.recalibrated(0.5), expected_revision=1)  # type: ignore[union-attr]
    assert (info.value.expected, info.value.actual) == (1, 2)
    project = await repo.get(pid)
    assert project is not None and project.revision == 2
    assert len(await ListRevisions(repo).execute(pid)) == 2


async def test_repository_detects_race_even_if_domain_check_passed(ready) -> None:  # type: ignore[no-untyped-def]
    repo, pid = ready
    a = await repo.get(pid)
    b = await repo.get(pid)
    assert a is not None and b is not None and a.model is not None
    a.update_model(a.model)
    await repo.save(a, expected_revision=1)
    b.update_model(b.model)  # su copia en memoria sigue creyendo que está en la 1
    with pytest.raises(ConcurrencyError):
        await repo.save(b, expected_revision=1)


async def test_restore_creates_new_revision_with_old_model(ready) -> None:  # type: ignore[no-untyped-def]
    repo, pid = ready
    original = (await repo.get(pid)).model  # type: ignore[union-attr]
    await UpdateBuildingModel(repo).execute(pid, original.recalibrated(0.02))  # type: ignore[union-attr]
    project = await RestoreRevision(repo).execute(pid, 1, expected_revision=2)
    assert project.revision == 3 and project.model == original
    assert (await ListRevisions(repo).execute(pid))[0].summary == "Restaurada la versión 1"
    with pytest.raises(EntityNotFoundError):
        await RestoreRevision(repo).execute(pid, 99)


async def test_correction_stats_against_detection(ready) -> None:  # type: ignore[no-untyped-def]
    repo, pid = ready
    stats = await GetCorrectionStats(repo).execute(pid)
    assert stats.correction_rate == 0
    model = (await repo.get(pid)).model  # type: ignore[union-attr]
    await UpdateBuildingModel(repo).execute(pid, model.recalibrated(0.02))  # type: ignore[union-attr]
    stats = await GetCorrectionStats(repo).execute(pid)
    assert stats.walls_moved + stats.walls_added + stats.walls_deleted >= 1


async def test_correction_stats_needs_model() -> None:
    repo, storage, queue = InMemoryProjectRepository(), InMemoryFileStorage(), RecordingQueue()
    pid = (await CreateProject(repo, storage, queue).execute("Casa", b"x", "image/jpeg")).id
    with pytest.raises(DomainError):
        await GetCorrectionStats(repo).execute(pid)
