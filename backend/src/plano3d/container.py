"""Composition root: el ÚNICO lugar que conoce las implementaciones concretas.

Aquí se decide qué adaptador va en cada puerto. Cambiar Postgres por memoria, o
S3 por disco, es cambiar una línea de configuración, no el código de negocio.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from plano3d.application.ports import FileStorage, JobQueue, ProgressBroker, ProjectRepository
from plano3d.application.use_cases.analyze import AnalyzeFloorPlan, DetectorSelector
from plano3d.application.use_cases.projects import (
    CalibrateScale,
    CreateProject,
    DeleteProject,
    GetProject,
    ListProjects,
    ReanalyzeProject,
    SuggestCorners,
    UpdateBuildingModel,
)
from plano3d.config import Settings
from plano3d.infrastructure.cv.classic_cv_detector import ClassicCVDetector
from plano3d.infrastructure.cv.imageio import OpenCVImageInspector, OpenCVPaperDetector
from plano3d.infrastructure.memory import (
    InMemoryFileStorage,
    InMemoryProgressBroker,
    InMemoryProjectRepository,
    InProcessJobQueue,
    LocalFileStorage,
)


@dataclass
class Container:
    repo: ProjectRepository
    storage: FileStorage
    queue: JobQueue
    progress: ProgressBroker
    selector: DetectorSelector
    _closers: list[object] = field(default_factory=list)

    @property
    def create_project(self) -> CreateProject:
        return CreateProject(self.repo, self.storage, self.queue)

    @property
    def get_project(self) -> GetProject:
        return GetProject(self.repo)

    @property
    def list_projects(self) -> ListProjects:
        return ListProjects(self.repo)

    @property
    def delete_project(self) -> DeleteProject:
        return DeleteProject(self.repo, self.storage)

    @property
    def update_model(self) -> UpdateBuildingModel:
        return UpdateBuildingModel(self.repo)

    @property
    def calibrate_scale(self) -> CalibrateScale:
        return CalibrateScale(self.repo)

    @property
    def reanalyze(self) -> ReanalyzeProject:
        return ReanalyzeProject(self.repo, self.queue, self.progress)

    @property
    def suggest_corners(self) -> SuggestCorners:
        return SuggestCorners(OpenCVPaperDetector())

    @property
    def analyze(self) -> AnalyzeFloorPlan:
        return AnalyzeFloorPlan(self.repo, self.storage, self.selector, self.progress)

    async def aclose(self) -> None:
        for c in self._closers:
            close = getattr(c, "aclose", None) or getattr(c, "dispose", None)
            if close is not None:
                await close()


def default_selector() -> DetectorSelector:
    # Orden de preferencia. Fases futuras: [SamRoomsDetector(), CubiCasaDetector(), ...]
    return DetectorSelector([ClassicCVDetector()], OpenCVImageInspector())


def memory_container(storage: FileStorage | None = None) -> Container:
    queue = InProcessJobQueue()
    c = Container(
        repo=InMemoryProjectRepository(),
        storage=storage or InMemoryFileStorage(),
        queue=queue,
        progress=InMemoryProgressBroker(),
        selector=default_selector(),
    )
    queue.bind(lambda pid: c.analyze.execute(pid))
    return c


def _storage(settings: Settings) -> FileStorage:
    if settings.storage == "s3":
        from plano3d.infrastructure.storage.s3_storage import S3FileStorage

        return S3FileStorage(
            settings.s3_bucket,
            settings.s3_endpoint_url,
            settings.s3_access_key,
            settings.s3_secret_key,
            settings.s3_region,
        )
    return LocalFileStorage(settings.storage_dir)


async def build_container(settings: Settings) -> Container:
    if settings.mode == "memory":
        return memory_container(_storage(settings))

    from arq import create_pool
    from arq.connections import RedisSettings
    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import create_async_engine

    from plano3d.infrastructure.jobs.arq_queue import ArqJobQueue
    from plano3d.infrastructure.persistence.sqlalchemy_repository import (
        SqlAlchemyProjectRepository,
    )
    from plano3d.infrastructure.realtime.redis_broker import RedisProgressBroker
    from plano3d.infrastructure.storage.s3_storage import S3FileStorage

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    redis = Redis.from_url(settings.redis_url)
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    storage = _storage(settings)
    if isinstance(storage, S3FileStorage):
        await storage.ensure_bucket()
    return Container(
        repo=SqlAlchemyProjectRepository(engine),
        storage=storage,
        queue=ArqJobQueue(arq_pool),
        progress=RedisProgressBroker(redis),
        selector=default_selector(),
        _closers=[engine, redis, arq_pool],
    )
