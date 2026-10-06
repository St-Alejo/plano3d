"""Proyecto: raíz de agregado con máquina de estados explícita."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

from plano3d.domain.building import BuildingModel, new_id
from plano3d.domain.errors import ConcurrencyError, DomainError, InvalidStateTransitionError


class ProjectStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


_ALLOWED: dict[ProjectStatus, set[ProjectStatus]] = {
    ProjectStatus.PENDING: {ProjectStatus.PROCESSING, ProjectStatus.FAILED},
    ProjectStatus.PROCESSING: {ProjectStatus.READY, ProjectStatus.FAILED},
    ProjectStatus.READY: {ProjectStatus.PROCESSING},
    ProjectStatus.FAILED: {ProjectStatus.PROCESSING},
}


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Project:
    id: str
    name: str
    original_image_key: str
    corners: list[tuple[float, float]] | None = None
    status: ProjectStatus = ProjectStatus.PENDING
    model: BuildingModel | None = None
    #: versión del modelo: sube en cada guardado (bloqueo optimista + historial)
    revision: int = 0
    error: str | None = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)

    @classmethod
    def create(
        cls,
        name: str,
        original_image_key: str,
        corners: list[tuple[float, float]] | None = None,
        project_id: str | None = None,
    ) -> Project:
        clean = name.strip()
        if not clean:
            raise DomainError("El proyecto necesita un nombre")
        if corners is not None and len(corners) != 4:
            raise DomainError("Se necesitan exactamente 4 esquinas")
        return cls(
            id=project_id or new_id("prj"),
            name=clean[:120],
            original_image_key=original_image_key,
            corners=corners,
        )

    def _transition(self, target: ProjectStatus) -> None:
        if target not in _ALLOWED[self.status]:
            raise InvalidStateTransitionError(f"No se puede pasar de {self.status} a {target}")
        self.status = target
        self.updated_at = _now()

    def start_processing(self) -> None:
        self._transition(ProjectStatus.PROCESSING)
        self.error = None

    def complete(self, model: BuildingModel) -> None:
        if model.project_id != self.id:
            raise DomainError("El modelo pertenece a otro proyecto")
        self._transition(ProjectStatus.READY)
        self.model = model
        self.revision += 1

    def fail(self, reason: str) -> None:
        self._transition(ProjectStatus.FAILED)
        self.error = reason

    def update_model(self, model: BuildingModel, expected_revision: int | None = None) -> None:
        """Corrección manual: solo tiene sentido cuando ya hay un modelo listo.

        Con ``expected_revision`` se aplica bloqueo optimista: si alguien guardó
        después de que el editor cargó el modelo, se rechaza en lugar de pisarlo.
        """
        if self.status is not ProjectStatus.READY:
            raise InvalidStateTransitionError("Solo se puede corregir un proyecto listo")
        if model.project_id != self.id:
            raise DomainError("El modelo pertenece a otro proyecto")
        if expected_revision is not None and expected_revision != self.revision:
            raise ConcurrencyError(expected_revision, self.revision)
        self.model = model
        self.revision += 1
        self.updated_at = _now()


@dataclass(frozen=True)
class ModelRevision:
    """Foto inmutable del modelo en un guardado (historial y restauración)."""

    project_id: str
    number: int
    model: BuildingModel
    summary: str
    created_at: datetime = field(default_factory=_now)
