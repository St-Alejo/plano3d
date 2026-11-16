"""Composition root: el ÚNICO lugar que conoce las implementaciones concretas.

Aquí se decide qué adaptador va en cada puerto. Cambiar Postgres por memoria, o
S3 por disco, es cambiar una línea de configuración, no el código de negocio.
"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field
from datetime import timedelta

from plano3d.application.collab.hub import CollabHub
from plano3d.application.ports import (
    FileStorage,
    JobQueue,
    LinkCodeStore,
    PasswordHasher,
    PhotoGenerator,
    PlanAssistant,
    ProgressBroker,
    ProjectRepository,
    ShareRepository,
    StateSnapshotStore,
    TextReader,
    TokenService,
    UserRepository,
)
from plano3d.application.use_cases.analyze import AnalyzeFloorPlan, DetectorSelector
from plano3d.application.use_cases.assistant import InterpretChat
from plano3d.application.use_cases.auth import (
    Authenticate,
    CreateLinkCode,
    CreateWsTicket,
    DemoLogin,
    ExchangeLinkCode,
    Login,
    Logout,
    RefreshSession,
    Register,
)
from plano3d.application.use_cases.levels import AddLevelFromFile, DuplicateLevel, FurnishLevels
from plano3d.application.use_cases.photos import GeneratePhotos
from plano3d.application.use_cases.projects import (
    CalibrateScale,
    CheckCapture,
    CreateBlankProject,
    CreateProject,
    DeleteProject,
    GetCorrectionStats,
    GetProject,
    GetRevision,
    ListProjects,
    ListRevisions,
    ReanalyzeProject,
    RestoreRevision,
    SetFacade,
    SolveDimensions,
    SuggestCorners,
    UpdateBuildingModel,
)
from plano3d.application.use_cases.renders import RenderGallery
from plano3d.application.use_cases.shares import (
    ClaimShare,
    CreateShareCode,
    ListShares,
    ResolveLink,
    RevokeShare,
)
from plano3d.config import Settings, ai_provider
from plano3d.infrastructure.auth import (
    Argon2PasswordHasher,
    InMemoryLinkCodeStore,
    JwtTokenService,
)
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
    InMemoryShareRepository,
    InMemoryUserRepository,
    InProcessJobQueue,
    LocalFileStorage,
)
from plano3d.infrastructure.ml.seg_model import WallSegmenter
from plano3d.infrastructure.ocr.claude import ClaudeTextReader
from plano3d.infrastructure.ocr.consensus import ConsensusReader
from plano3d.infrastructure.ocr.rapid import RapidOcrReader, RapidOcrSpotter
from plano3d.infrastructure.ocr.rapid import available as ocr_available
from plano3d.infrastructure.vector.detectors import DxfDetector, VectorPdfDetector

log = logging.getLogger(__name__)


def token_service(settings: Settings | None = None) -> TokenService:
    """Tokens firmados con ``PLANO3D_JWT_SECRET``; sin él, con un secreto al azar."""
    secret = settings.jwt_secret if settings else ""
    if not secret:
        secret = secrets.token_urlsafe(48)
        if settings is not None and settings.auth_required:
            log.warning("PLANO3D_JWT_SECRET vacío: las sesiones se pierden al reiniciar la API")
    return JwtTokenService(
        secret,
        access_ttl=timedelta(minutes=settings.access_ttl_minutes if settings else 60),
        refresh_ttl=timedelta(days=settings.refresh_ttl_days if settings else 30),
    )


def default_assistant() -> PlanAssistant | None:
    provider = ai_provider()
    if provider == "groq":
        from plano3d.infrastructure.groq.assistant import GroqPlanAssistant

        return GroqPlanAssistant()
    if provider == "claude":
        from plano3d.infrastructure.assistant.claude_assistant import ClaudePlanAssistant

        return ClaudePlanAssistant()
    return None


def default_photos() -> PhotoGenerator | None:
    """Fotos realistas con OpenAI si hay clave (``OPENAI_API_KEY`` en ``backend/.env``)."""
    from plano3d.config import load_local_env
    from plano3d.infrastructure.openai.images import OpenAIPhotoGenerator, openai_available

    load_local_env()
    return OpenAIPhotoGenerator() if openai_available() else None


@dataclass
class Container:
    repo: ProjectRepository
    storage: FileStorage
    queue: JobQueue
    progress: ProgressBroker
    selector: DetectorSelector
    _closers: list[object] = field(default_factory=list)
    #: intérprete con IA del chat del editor (None: solo el intérprete local del navegador)
    assistant: PlanAssistant | None = field(default_factory=lambda: default_assistant())
    #: fotos realistas del modelo 3D (None: el botón avisa que no está configurado)
    photos: PhotoGenerator | None = field(default_factory=lambda: default_photos())
    # ---- cuentas (ADR-020)
    users: UserRepository = field(default_factory=InMemoryUserRepository)
    hasher: PasswordHasher = field(default_factory=Argon2PasswordHasher)
    tokens: TokenService = field(default_factory=token_service)
    link_codes: LinkCodeStore = field(default_factory=InMemoryLinkCodeStore)
    #: códigos para compartir con otra app (ADR-024)
    shares: ShareRepository = field(default_factory=InMemoryShareRepository)
    #: False = API sin login (pruebas): todos los proyectos son visibles
    auth_required: bool = True
    demo_enabled: bool = True
    _hub: CollabHub | None = None

    @property
    def collab(self) -> CollabHub:
        """Salas de edición en vivo (una réplica: viven en memoria del proceso).

        Se crea al primer uso para tomar el repositorio ya envuelto (copia en Blob).
        """
        if self._hub is None:
            self._hub = CollabHub(self.repo)
        return self._hub

    def configure(self, settings: Settings) -> Container:
        """Ajusta lo que depende de la configuración (secreto de tokens, login, demo)."""
        self.tokens = token_service(settings)
        self.auth_required = settings.auth_required
        self.demo_enabled = settings.demo_enabled
        return self

    @property
    def register(self) -> Register:
        return Register(self.users, self.tokens, self.hasher)

    @property
    def login(self) -> Login:
        return Login(self.users, self.tokens, self.hasher)

    @property
    def refresh_session(self) -> RefreshSession:
        return RefreshSession(self.users, self.tokens)

    @property
    def authenticate(self) -> Authenticate:
        return Authenticate(self.users, self.tokens)

    @property
    def logout(self) -> Logout:
        return Logout(self.users)

    @property
    def demo_login(self) -> DemoLogin:
        return DemoLogin(self.users, self.tokens, self.demo_enabled)

    @property
    def create_link_code(self) -> CreateLinkCode:
        return CreateLinkCode(self.link_codes)

    @property
    def exchange_link_code(self) -> ExchangeLinkCode:
        return ExchangeLinkCode(self.users, self.tokens, self.link_codes)

    @property
    def create_ws_ticket(self) -> CreateWsTicket:
        return CreateWsTicket(self.tokens)

    @property
    def create_share(self) -> CreateShareCode:
        return CreateShareCode(self.repo, self.shares)

    @property
    def list_shares(self) -> ListShares:
        return ListShares(self.shares)

    @property
    def revoke_share(self) -> RevokeShare:
        return RevokeShare(self.shares)

    @property
    def claim_share(self) -> ClaimShare:
        return ClaimShare(self.repo, self.shares, self.tokens)

    @property
    def resolve_link(self) -> ResolveLink:
        return ResolveLink(self.repo, self.shares, self.tokens)

    @property
    def create_project(self) -> CreateProject:
        return CreateProject(self.repo, self.storage, self.queue, OpenCVStitcher())

    @property
    def create_blank_project(self) -> CreateBlankProject:
        return CreateBlankProject(self.repo)

    @property
    def interpret_chat(self) -> InterpretChat:
        return InterpretChat(self.repo, self.assistant)

    @property
    def generate_photos(self) -> GeneratePhotos:
        return GeneratePhotos(self.repo, self.photos)

    @property
    def renders(self) -> RenderGallery:
        return RenderGallery(self.repo, self.storage, self.collab.announce)

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
    def set_facade(self) -> SetFacade:
        return SetFacade(self.repo)

    @property
    def furnish(self) -> FurnishLevels:
        return FurnishLevels(self.repo)

    @property
    def add_level(self) -> AddLevelFromFile:
        return AddLevelFromFile(self.repo, self.selector)

    @property
    def duplicate_level(self) -> DuplicateLevel:
        return DuplicateLevel(self.repo)

    @property
    def suggest_corners(self) -> SuggestCorners:
        return SuggestCorners(OpenCVPaperDetector())

    @property
    def analyze(self) -> AnalyzeFloorPlan:
        return AnalyzeFloorPlan(self.repo, self.storage, self.selector, self.progress)

    async def aclose(self) -> None:
        if self._hub is not None:
            await self._hub.aclose()  # antes que la copia: lo último editado entra en ella
        for c in [*self._closers, self.photos]:
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
    # fotos: además de la lectura por línea de cota, cotas "texto primero" y nombres
    spotter = RapidOcrSpotter() if ocr_available() else None
    raster = RasterVectorDetector(reader, spotter)
    photo = MultiLevelDetector(HybridPhotoDetector(raster, classic))
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
    """OCR local; con un proveedor de IA (Claude o Groq), en consenso con su visión."""
    local = RapidOcrReader() if ocr_available() else None
    provider = ai_provider()
    vision: TextReader | None = None
    if provider == "claude":
        vision = ClaudeTextReader()
    elif provider == "groq":
        from plano3d.infrastructure.groq.reader import GroqTextReader

        vision = GroqTextReader()
    if vision is None:
        return local
    return ConsensusReader(local, vision) if local else vision


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
    if settings.storage == "blob":
        from plano3d.infrastructure.storage.blob_storage import BlobFileStorage

        return BlobFileStorage(settings.blob_connection_string, settings.blob_container)
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


def snapshot_store(settings: Settings) -> StateSnapshotStore | None:
    """Dónde guardar la copia del estado de la API en memoria (None = no se guarda)."""
    if settings.snapshot == "blob":
        from plano3d.infrastructure.storage.blob_storage import BlobSnapshotStore

        return BlobSnapshotStore(settings.blob_connection_string, settings.blob_container)
    if settings.snapshot == "file":
        from plano3d.infrastructure.snapshot import FileSnapshotStore

        return FileSnapshotStore(settings.snapshot_file)
    return None


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
        SqlAlchemyShareRepository,
        SqlAlchemyUserRepository,
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
        users=SqlAlchemyUserRepository(engine),
        shares=SqlAlchemyShareRepository(engine),
        _closers=[engine, redis, arq_pool],
    )
