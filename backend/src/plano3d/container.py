"""Composition root: el ÚNICO lugar que conoce las implementaciones concretas.

Aquí se decide qué adaptador va en cada puerto. Cambiar Postgres por memoria, o
S3 por disco, es cambiar una línea de configuración, no el código de negocio.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from plano3d.application.ports import (
    FileStorage,
    JobQueue,
    ProgressBroker,
    ProjectRepository,
    TextReader,
)
from plano3d.application.use_cases.analyze import AnalyzeFloorPlan, DetectorSelector
from plano3d.application.use_cases.projects import (
    CalibrateScale,
    CheckCapture,
    CreateProject,
    DeleteProject,
    GetCorrectionStats,
    GetProject,
    GetRevision,
    ListProjects,
    ListRevisions,
    ReanalyzeProject,
    RestoreRevision,
    SolveDimensions,
    SuggestCorners,
    UpdateBuildingModel,
)
from plano3d.config import Settings, load_local_env
from plano3d.infrastructure.cv.capture import OpenCVCaptureInspector, OpenCVStitcher
from plano3d.infrastructure.cv.classic_cv_detector import ClassicCVDetector
from plano3d.infrastructure.cv.imageio import OpenCVImageInspector, OpenCVPaperDetector
from plano3d.infrastructure.cv.multilevel import MultiLevelDetector
from plano3d.infrastructure.cv.raster_vector_detector import (
    HybridPhotoDetector,
    RasterVectorDetector,
)
from plano3d.infrastructure.cv.stages.walls import WallProbability
from plano3d.infrastructure.memory import (
    InMemoryFileStorage,
    InMemoryProgressBroker,
    InMemoryProjectRepository,
    InProcessJobQueue,
    LocalFileStorage,
)
from plano3d.infrastructure.ml.seg_model import WallSegmenter
from plano3d.infrastructure.ocr.claude import ClaudeTextReader, claude_available
from plano3d.infrastructure.ocr.consensus import ConsensusReader
from plano3d.infrastructure.ocr.rapid import RapidOcrReader, RapidOcrSpotter
from plano3d.infrastructure.ocr.rapid import available as ocr_available
from plano3d.infrastructure.vector.detectors import DxfDetector, VectorPdfDetector


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
        return CreateProject(self.repo, self.storage, self.queue, OpenCVStitcher())

    @property
    def check_capture(self) -> CheckCapture:
        return CheckCapture(OpenCVCaptureInspector())

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
    def list_revisions(self) -> ListRevisions:
        return ListRevisions(self.repo)

    @property
    def get_revision(self) -> GetRevision:
        return GetRevision(self.repo)

    @property
    def restore_revision(self) -> RestoreRevision:
        return RestoreRevision(self.repo)

    @property
    def correction_stats(self) -> GetCorrectionStats:
        return GetCorrectionStats(self.repo)

    @property
    def solve_dimensions(self) -> SolveDimensions:
        return SolveDimensions(self.repo)

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
    # Orden de preferencia: primero la ruta exacta (archivos vectoriales), la CV clásica
    # queda siempre como respaldo para fotos e imágenes.
    reader = text_reader()
    # la lectura de nombres de ambientes es local (sin costo); sin OCR quedan genéricos
    classic = ClassicCVDetector(RapidOcrSpotter() if ocr_available() else None, wall_segmenter())
    # una lámina con varias plantas se separa y cada planta pasa por el detector híbrido
    photo = MultiLevelDetector(HybridPhotoDetector(RasterVectorDetector(reader), classic))
    return DetectorSelector(
        [DxfDetector(), VectorPdfDetector(), photo, classic], OpenCVImageInspector()
    )


def wall_segmenter() -> WallProbability | None:
    """Red de muros (ONNX) si está publicada; se apaga con ``PLANO3D_SEG_MODEL=0``.

    Solo actúa en láminas CAD de fondo oscuro (ver ``WallMaskStage``).
    """
    if os.environ.get("PLANO3D_SEG_MODEL", "1").lower() not in ("1", "true", "si", "sí"):
        return None
    seg = WallSegmenter()
    return seg.probability if seg.available else None


def text_reader() -> TextReader | None:
    """OCR local; con credenciales de Anthropic, en consenso con Claude visión."""
    load_local_env()
    local = RapidOcrReader() if ocr_available() else None
    if claude_available():
        claude = ClaudeTextReader()
        return ConsensusReader(local, claude) if local else claude
    return local


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
