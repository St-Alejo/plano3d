"""Casos de uso con adaptadores en memoria y un detector falso (sin visión real)."""

from __future__ import annotations

import pytest

from plano3d.application.dto import ProgressEventDTO
from plano3d.application.ports import (
    DetectionRequest,
    DetectionResult,
    FloorPlanDetector,
    ImageQuality,
    ProgressPublisher,
)
from plano3d.application.use_cases.analyze import (
    AnalyzeFloorPlan,
    DetectorSelector,
    ImageInspector,
)
from plano3d.application.use_cases.errors import (
    FileTooLargeError,
    NoDetectorAvailableError,
    ProjectNotFoundError,
    UnsupportedFileError,
)
from plano3d.application.use_cases.projects import (
    MAX_UPLOAD_BYTES,
    CalibrateScale,
    CreateProject,
    DeleteProject,
    GetProject,
    ListProjects,
    ReanalyzeProject,
    UpdateBuildingModel,
)
from plano3d.domain import (
    BuildingModel,
    Level,
    Point2D,
    ProjectStatus,
    Room,
    Scale,
    SourceImage,
    Wall,
)
from plano3d.domain.errors import DomainError, InvalidStateTransitionError
from plano3d.infrastructure.memory import (
    InMemoryFileStorage,
    InMemoryProgressBroker,
    InMemoryProjectRepository,
    InProcessJobQueue,
)


class FakeDetector(FloorPlanDetector):
    def __init__(self, name: str = "classic-cv", ok: bool = True, min_width: int = 0) -> None:
        self.name = name  # type: ignore[assignment]
        self.ok = ok
        self.min_width = min_width
        self.calls = 0

    def supports(self, quality: ImageQuality) -> bool:
        return quality.width >= self.min_width

    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult:
        self.calls += 1
        if not self.ok:
            raise RuntimeError("detector roto")
        room = Room("r1", "sala", (Point2D(0, 0), Point2D(4, 0), Point2D(4, 3), Point2D(0, 3)))
        wall = Wall("w1", Point2D(0, 0), Point2D(4, 0))
        model = BuildingModel(
            request.project_id,
            Scale(0.01),
            (Level("l0", "PB", walls=(wall,), rooms=(room,)),),
            SourceImage("", 400, 300),
        )
        return DetectionResult(model, b"png", {"walls": 1})


class FakeInspector(ImageInspector):
    def __init__(self, width: int = 1000) -> None:
        self.width = width

    def inspect(self, data: bytes, content_type: str) -> ImageQuality:
        return ImageQuality(self.width, 800, 100.0, 50.0)


class RecordingQueue(InProcessJobQueue):
    def __init__(self) -> None:
        super().__init__()
        self.enqueued: list[str] = []

    async def enqueue_analysis(self, project_id: str) -> None:
        self.enqueued.append(project_id)


@pytest.fixture
def repo() -> InMemoryProjectRepository:
    return InMemoryProjectRepository()


@pytest.fixture
def storage() -> InMemoryFileStorage:
    return InMemoryFileStorage()


@pytest.fixture
def queue() -> RecordingQueue:
    return RecordingQueue()


@pytest.fixture
def broker() -> InMemoryProgressBroker:
    return InMemoryProgressBroker()


async def _create(repo, storage, queue) -> str:  # type: ignore[no-untyped-def]
    p = await CreateProject(repo, storage, queue).execute("Casa", b"img", "image/jpeg")
    return p.id


async def _ready(repo, storage, queue, broker, detector=None) -> str:  # type: ignore[no-untyped-def]
    pid = await _create(repo, storage, queue)
    selector = DetectorSelector([detector or FakeDetector()], FakeInspector())
    await AnalyzeFloorPlan(repo, storage, selector, broker).execute(pid)
    return pid


# --------------------------------------------------------------------------- create


async def test_create_stores_file_and_enqueues(repo, storage, queue) -> None:  # type: ignore[no-untyped-def]
    pid = await _create(repo, storage, queue)
    project = await repo.get(pid)
    assert project is not None and project.status is ProjectStatus.PENDING
    assert project.original_image_key in storage.files
    assert queue.enqueued == [pid]


@pytest.mark.parametrize("ctype", ["image/gif", "text/plain", ""])
async def test_create_rejects_unsupported_types(repo, storage, queue, ctype) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(UnsupportedFileError):
        await CreateProject(repo, storage, queue).execute("x", b"data", ctype)
    assert storage.files == {} and queue.enqueued == []


async def test_create_rejects_empty_and_huge_files(repo, storage, queue) -> None:  # type: ignore[no-untyped-def]
    uc = CreateProject(repo, storage, queue)
    with pytest.raises(UnsupportedFileError):
        await uc.execute("x", b"", "image/png")
    with pytest.raises(FileTooLargeError):
        await uc.execute("x", b"0" * (MAX_UPLOAD_BYTES + 1), "image/png")


# --------------------------------------------------------------------------- analyze


async def test_analyze_happy_path(repo, storage, queue, broker) -> None:  # type: ignore[no-untyped-def]
    pid = await _ready(repo, storage, queue, broker)
    project = await repo.get(pid)
    assert project is not None and project.status is ProjectStatus.READY
    assert project.model is not None and project.model.source_image is not None
    assert project.model.source_image.key == f"rectified/{pid}.png"
    assert storage.files[f"rectified/{pid}.png"][0] == b"png"
    last = (await broker.history(pid))[-1]
    assert last.stage == "done" and last.status == "completed"
    assert last.metrics["total_area_m2"] == pytest.approx(12)


async def test_analyze_failure_marks_project_failed(repo, storage, queue, broker) -> None:  # type: ignore[no-untyped-def]
    pid = await _ready(repo, storage, queue, broker, FakeDetector(ok=False))
    project = await repo.get(pid)
    assert project is not None and project.status is ProjectStatus.FAILED
    assert project.error == "detector roto"
    assert (await broker.history(pid))[-1].status == "failed"


async def test_analyze_unknown_project(repo, storage, broker) -> None:  # type: ignore[no-untyped-def]
    selector = DetectorSelector([FakeDetector()], FakeInspector())
    with pytest.raises(ProjectNotFoundError):
        await AnalyzeFloorPlan(repo, storage, selector, broker).execute("nope")


# --------------------------------------------------------------------------- selector


def test_selector_picks_first_supported() -> None:
    big = FakeDetector("sam-rooms", min_width=2000)
    base = FakeDetector("classic-cv")
    sel = DetectorSelector([big, base], FakeInspector(width=1000))
    assert sel.choose(b"", "image/png") is base
    assert sel.available == ["sam-rooms", "classic-cv"]


def test_selector_honours_preference_and_errors() -> None:
    a, b = FakeDetector("classic-cv"), FakeDetector("vlm-semantic")
    sel = DetectorSelector([a, b], FakeInspector())
    assert sel.choose(b"", "image/png", preferred="vlm-semantic") is b
    with pytest.raises(NoDetectorAvailableError):
        sel.choose(b"", "image/png", preferred="cnn-cubicasa")
    picky = DetectorSelector([FakeDetector(min_width=5000)], FakeInspector(width=100))
    with pytest.raises(NoDetectorAvailableError):
        picky.choose(b"", "image/png")
    with pytest.raises(ValueError):
        DetectorSelector([], FakeInspector())


# --------------------------------------------------------------------------- edit / calibrate


async def test_update_model_and_calibrate(repo, storage, queue, broker) -> None:  # type: ignore[no-untyped-def]
    pid = await _ready(repo, storage, queue, broker)
    project = await GetProject(repo).execute(pid)
    assert project.model is not None
    edited = project.model.with_level(
        project.model.level("l0").with_room(
            project.model.level("l0").room("r1").relabeled("cocina")
        )
    )
    await UpdateBuildingModel(repo).execute(pid, edited)
    # 400 px == 8 m → 0.02 m/px (el doble de la escala original)
    project = await CalibrateScale(repo).execute(pid, Point2D(0, 0), Point2D(400, 0), 8.0)
    assert project.model is not None
    assert project.model.scale.meters_per_pixel == pytest.approx(0.02)
    assert project.model.level("l0").room("r1").label == "cocina"
    assert project.model.total_area == pytest.approx(48)


async def test_calibrate_rejects_tiny_line(repo, storage, queue, broker) -> None:  # type: ignore[no-untyped-def]
    pid = await _ready(repo, storage, queue, broker)
    with pytest.raises(DomainError):
        await CalibrateScale(repo).execute(pid, Point2D(0, 0), Point2D(2, 0), 1.0)


async def test_calibrate_needs_model(repo, storage, queue) -> None:  # type: ignore[no-untyped-def]
    pid = await _create(repo, storage, queue)
    with pytest.raises(DomainError):
        await CalibrateScale(repo).execute(pid, Point2D(0, 0), Point2D(200, 0), 1.0)


# ------------------------------------------------------------- list / delete / reanalyze


async def test_list_is_newest_first_and_delete_cleans_files(repo, storage, queue, broker) -> None:  # type: ignore[no-untyped-def]
    first = await _ready(repo, storage, queue, broker)
    second = await _create(repo, storage, queue)
    assert [p.id for p in await ListProjects(repo).execute()] == [second, first]
    await DeleteProject(repo, storage).execute(first)
    assert await repo.get(first) is None
    assert not any(first in k for k in storage.files)
    with pytest.raises(ProjectNotFoundError):
        await DeleteProject(repo, storage).execute(first)


async def test_reanalyze(repo, storage, queue, broker) -> None:  # type: ignore[no-untyped-def]
    pid = await _create(repo, storage, queue)
    uc = ReanalyzeProject(repo, queue, broker)
    with pytest.raises(InvalidStateTransitionError):
        await uc.execute(pid)  # sigue pendiente
    pid = await _ready(repo, storage, queue, broker)
    corners = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]
    await uc.execute(pid, corners)
    assert queue.enqueued[-1] == pid
    assert (await broker.history(pid)) == []
    project = await repo.get(pid)
    assert project is not None and project.corners == corners
    with pytest.raises(DomainError):
        await uc.execute(pid, [(0, 0)])


# --------------------------------------------------------------------------- broker


async def test_broker_replays_history_then_live_events(broker) -> None:  # type: ignore[no-untyped-def]
    def ev(stage: str) -> ProgressEventDTO:
        return ProgressEventDTO(project_id="p", stage=stage, status="completed", index=0, total=1)

    await broker.publish(ev("ingest"))
    received: list[str] = []

    async def consume() -> None:
        async for e in broker.subscribe("p"):
            received.append(e.stage)

    import asyncio

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await broker.publish(ev("walls"))
    await broker.publish(ev("done"))
    await asyncio.wait_for(task, 1)
    assert received == ["ingest", "walls", "done"]
