"""Casos de uso de gestión de proyectos. Solo conocen puertos."""

from __future__ import annotations

from collections.abc import Sequence

from plano3d.application.ports import (
    FileStorage,
    JobQueue,
    PaperDetector,
    ProgressBroker,
    ProjectRepository,
)
from plano3d.application.use_cases.errors import (
    FileTooLargeError,
    ProjectNotFoundError,
    UnsupportedFileError,
)
from plano3d.domain import BuildingModel, Point2D, Project, ProjectStatus, new_id
from plano3d.domain.errors import DomainError, InvalidStateTransitionError

ALLOWED_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


async def _load(repo: ProjectRepository, project_id: str) -> Project:
    project = await repo.get(project_id)
    if project is None:
        raise ProjectNotFoundError(project_id)
    return project


class CreateProject:
    def __init__(self, repo: ProjectRepository, storage: FileStorage, queue: JobQueue) -> None:
        self._repo = repo
        self._storage = storage
        self._queue = queue

    async def execute(
        self,
        name: str,
        data: bytes,
        content_type: str,
        corners: Sequence[tuple[float, float]] | None = None,
    ) -> Project:
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
        raise UnsupportedFileError(f"Tipo {content_type!r} no soportado. Usa JPG, PNG, WEBP o PDF.")
    if not data:
        raise UnsupportedFileError("El archivo está vacío")
    if len(data) > MAX_UPLOAD_BYTES:
        raise FileTooLargeError(f"El archivo supera {MAX_UPLOAD_BYTES // 1024 // 1024} MB")
    return ext


class SuggestCorners:
    """Antes de subir: propone dónde están las esquinas de la hoja para ajustarlas a mano."""

    def __init__(self, detector: PaperDetector) -> None:
        self._detector = detector

    def execute(self, data: bytes, content_type: str) -> list[tuple[float, float]] | None:
        _check_upload(data, content_type)
        if content_type == "application/pdf":
            return None  # un PDF ya es una vista cenital
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
        return sorted(await self._repo.list(), key=lambda p: p.created_at, reverse=True)


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

    async def execute(self, project_id: str, model: BuildingModel) -> Project:
        project = await _load(self._repo, project_id)
        project.update_model(model)
        await self._repo.save(project)
        return project


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
        project.update_model(project.model.recalibrated(meters / pixels))
        await self._repo.save(project)
        return project


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
