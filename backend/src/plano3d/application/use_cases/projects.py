"""Casos de uso de gestión de proyectos. Solo conocen puertos."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import replace

from plano3d.application.ports import (
    CaptureInspector,
    FileStorage,
    ImageStitcher,
    JobQueue,
    PaperDetector,
    ProgressBroker,
    ProjectRepository,
    ShotReport,
)
from plano3d.application.use_cases.errors import (
    FileTooLargeError,
    ProjectNotFoundError,
    UnsupportedFileError,
)
from plano3d.domain import BuildingModel, ModelRevision, Point2D, Project, ProjectStatus, new_id
from plano3d.domain.errors import DomainError, EntityNotFoundError, InvalidStateTransitionError
from plano3d.domain.quality import CorrectionStats, correction_stats
from plano3d.domain.solver import SolveReport, solve_level

ALLOWED_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/dxf": "dxf",
}
#: nombres con que los navegadores y programas CAD envían un DXF
DXF_ALIASES = frozenset(
    {"application/dxf", "image/vnd.dxf", "image/x-dxf", "application/x-dxf", "drawing/x-dxf"}
)


def normalize_content_type(content_type: str, filename: str | None = None) -> str:
    """Unifica los alias de DXF; un .dxf sin tipo (octet-stream) también cuenta."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in DXF_ALIASES:
        return "application/dxf"
    if filename and filename.lower().endswith(".dxf") and ct in ("", "application/octet-stream"):
        return "application/dxf"
    return ct


MAX_UPLOAD_BYTES = 25 * 1024 * 1024


#: prefijo de las revisiones creadas por el detector (la base de la tasa de corrección)
DETECTION_SUMMARY = "Detección automática"


async def _load(repo: ProjectRepository, project_id: str) -> Project:
    project = await repo.get(project_id)
    if project is None:
        raise ProjectNotFoundError(project_id)
    return project


async def commit_model(
    repo: ProjectRepository,
    project: Project,
    model: BuildingModel,
    summary: str,
    expected_revision: int | None = None,
) -> Project:
    """Aplica un modelo nuevo, lo guarda con bloqueo optimista y registra la revisión."""
    before = project.revision
    project.update_model(model, expected_revision)
    await repo.save(project, expected_revision=before)
    await repo.add_revision(ModelRevision(project.id, project.revision, model, summary))
    return project


class CreateProject:
    def __init__(
        self,
        repo: ProjectRepository,
        storage: FileStorage,
        queue: JobQueue,
        stitcher: ImageStitcher | None = None,
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._queue = queue
        self._stitcher = stitcher

    async def execute(
        self,
        name: str,
        data: bytes,
        content_type: str,
        corners: Sequence[tuple[float, float]] | None = None,
        extra: Sequence[tuple[bytes, str]] = (),
    ) -> Project:
        """``extra``: más fotos de la MISMA hoja (plano grande tomado por partes)."""
        if extra:
            if self._stitcher is None:
                raise UnsupportedFileError("Este servidor no une varias fotos")
            for d, ct in [(data, content_type), *extra]:
                if not ct.startswith("image/"):
                    raise UnsupportedFileError("Solo se pueden unir fotos (JPG, PNG o WEBP)")
                _check_upload(d, ct)
            images = [data, *(d for d, _ in extra)]
            data = await asyncio.to_thread(self._stitcher.stitch, images)
            content_type = "image/png"
            corners = None  # la unión ya es una vista de la hoja
        ext = _check_upload(data, content_type)
        project_id = new_id("prj")
        key = f"originals/{project_id}.{ext}"
        project = Project.create(
            name, key, list(corners) if corners else None, project_id=project_id
        )
        await self._storage.put(key, data, content_type)
        await self._repo.add(project)
        await self._queue.enqueue_analysis(project.id)
        return project


def _check_upload(data: bytes, content_type: str) -> str:
    ext = ALLOWED_TYPES.get(content_type)
    if ext is None:
        raise UnsupportedFileError(
            f"Tipo {content_type!r} no soportado. Usa JPG, PNG, WEBP, PDF o DXF."
        )
    if not data:
        raise UnsupportedFileError("El archivo está vacío")
    if len(data) > MAX_UPLOAD_BYTES:
        raise FileTooLargeError(f"El archivo supera {MAX_UPLOAD_BYTES // 1024 // 1024} MB")
    return ext


class CheckCapture:
    """Antes de subir: ¿la foto sirve? (nitidez, reflejos, resolución, hoja visible)."""

    def __init__(self, inspector: CaptureInspector) -> None:
        self._inspector = inspector

    def execute(self, data: bytes, content_type: str) -> ShotReport:
        _check_upload(data, content_type)
        if not content_type.startswith("image/"):
            return ShotReport(0.0, 0.0, 0, 0, True, ())
        try:
            return self._inspector.check(data, content_type)
        except ValueError as exc:
            raise UnsupportedFileError(str(exc)) from exc


class SuggestCorners:
    """Antes de subir: propone dónde están las esquinas de la hoja para ajustarlas a mano."""

    def __init__(self, detector: PaperDetector) -> None:
        self._detector = detector

    def execute(self, data: bytes, content_type: str) -> list[tuple[float, float]] | None:
        _check_upload(data, content_type)
        if content_type in ("application/pdf", "application/dxf"):
            return None  # un PDF o un DXF ya son una vista cenital
        try:
            return self._detector.detect(data, content_type)
        except ValueError as exc:
            raise UnsupportedFileError(str(exc)) from exc


class GetProject:
    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(self, project_id: str) -> Project:
        return await _load(self._repo, project_id)


class ListProjects:
    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(self) -> list[Project]:
        # orden estable ascendente y luego invertido: ante fechas iguales (mismo milisegundo)
        # el último creado queda primero; `reverse=True` conservaría el orden de inserción
        return list(reversed(sorted(await self._repo.list(), key=lambda p: p.created_at)))


class DeleteProject:
    def __init__(self, repo: ProjectRepository, storage: FileStorage) -> None:
        self._repo = repo
        self._storage = storage

    async def execute(self, project_id: str) -> None:
        project = await _load(self._repo, project_id)
        await self._storage.delete(project.original_image_key)
        if project.model and project.model.source_image:
            await self._storage.delete(project.model.source_image.key)
        await self._repo.delete(project_id)


class UpdateBuildingModel:
    """Corrección manual desde el editor 2D: el modelo completo reemplaza al anterior."""

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(
        self,
        project_id: str,
        model: BuildingModel,
        expected_revision: int | None = None,
        summary: str = "Corrección manual",
    ) -> Project:
        project = await _load(self._repo, project_id)
        return await commit_model(
            self._repo,
            project,
            model,
            summary.strip()[:200] or "Corrección manual",
            expected_revision,
        )


class CalibrateScale:
    """El usuario marca dos puntos de la imagen y cuántos metros hay entre ellos."""

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(
        self, project_id: str, a_px: Point2D, b_px: Point2D, meters: float
    ) -> Project:
        project = await _load(self._repo, project_id)
        if project.model is None:
            raise DomainError("El proyecto aún no tiene modelo")
        pixels = a_px.distance_to(b_px)
        if pixels < 5 or meters <= 0:
            raise DomainError("La línea de calibración es demasiado corta")
        return await commit_model(
            self._repo,
            project,
            project.model.recalibrated(meters / pixels),
            f"Calibración de escala ({meters:.2f} m)",
        )


class SolveDimensions:
    """Ajusta la geometría a las cotas escritas en el plano (ADR-015).

    Se usa tras corregir el valor de una cota en el editor: los muros toman las medidas
    del plano, las cotas quedan EXACTAS o en CONFLICTO y se registra una versión nueva.
    """

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(
        self, project_id: str, expected_revision: int | None = None
    ) -> tuple[Project, SolveReport]:
        project = await _load(self._repo, project_id)
        if project.model is None:
            raise DomainError("El proyecto aún no tiene modelo")
        levels = []
        total = SolveReport()
        for lv in project.model.levels:
            solved, rep = solve_level(lv)
            levels.append(solved)
            total.dims_exact += rep.dims_exact
            total.dims_conflict += rep.dims_conflict
            total.dims_unlinked += rep.dims_unlinked
            total.walls_exact += rep.walls_exact
            total.max_residual = max(total.max_residual, rep.max_residual)
            total.moved_max = max(total.moved_max, rep.moved_max)
            total.conflicts += rep.conflicts
        model = replace(project.model, levels=tuple(levels))
        summary = (
            f"Ajuste a cotas ({total.dims_exact} exactas"
            + (f", {total.dims_conflict} en conflicto" if total.dims_conflict else "")
            + ")"
        )
        project = await commit_model(self._repo, project, model, summary, expected_revision)
        return project, total


class ReanalyzeProject:
    """Vuelve a encolar el análisis (p. ej. tras un fallo o con otras esquinas)."""

    def __init__(self, repo: ProjectRepository, queue: JobQueue, progress: ProgressBroker) -> None:
        self._repo = repo
        self._queue = queue
        self._progress = progress

    async def execute(
        self, project_id: str, corners: Sequence[tuple[float, float]] | None = None
    ) -> Project:
        project = await _load(self._repo, project_id)
        if project.status in (ProjectStatus.PENDING, ProjectStatus.PROCESSING):
            raise InvalidStateTransitionError("El proyecto ya se está analizando")
        if corners is not None:
            if len(corners) != 4:
                raise DomainError("Se necesitan exactamente 4 esquinas")
            project.corners = list(corners)
            await self._repo.save(project)
        await self._progress.reset(project_id)
        await self._queue.enqueue_analysis(project_id)
        return project


class ListRevisions:
    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(self, project_id: str) -> list[ModelRevision]:
        await _load(self._repo, project_id)
        return await self._repo.list_revisions(project_id)


class GetRevision:
    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(self, project_id: str, number: int) -> ModelRevision:
        await _load(self._repo, project_id)
        rev = await self._repo.get_revision(project_id, number)
        if rev is None:
            raise EntityNotFoundError(f"La versión {number} no existe")
        return rev


class RestoreRevision:
    """Volver a una versión anterior crea una versión NUEVA (el historial nunca se reescribe)."""

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(
        self, project_id: str, number: int, expected_revision: int | None = None
    ) -> Project:
        project = await _load(self._repo, project_id)
        rev = await self._repo.get_revision(project_id, number)
        if rev is None:
            raise EntityNotFoundError(f"La versión {number} no existe")
        return await commit_model(
            self._repo, project, rev.model, f"Restaurada la versión {number}", expected_revision
        )


class GetCorrectionStats:
    """Qué tanto se corrigió respecto de la última detección automática."""

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(self, project_id: str) -> CorrectionStats:
        project = await _load(self._repo, project_id)
        if project.model is None:
            raise DomainError("El proyecto aún no tiene modelo")
        revisions = await self._repo.list_revisions(project_id)
        detected = next((r for r in revisions if r.summary.startswith(DETECTION_SUMMARY)), None)
        if detected is None:
            raise DomainError("No hay una detección automática registrada")
        return correction_stats(detected.model, project.model)
