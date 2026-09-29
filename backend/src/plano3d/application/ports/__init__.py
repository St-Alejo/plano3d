"""Puertos (interfaces) del hexágono. Los casos de uso dependen SOLO de esto.

Cada puerto tiene al menos dos adaptadores: uno real (infraestructura) y uno en
memoria para tests, lo que demuestra que el dominio no conoce los detalles.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import numpy.typing as npt

from plano3d.application.dto import ProgressEventDTO
from plano3d.domain import BuildingModel, Project

Image = npt.NDArray[np.uint8]
DetectorName = Literal["classic-cv", "cnn-cubicasa", "sam-rooms", "vlm-semantic"]


@dataclass(frozen=True)
class DetectionRequest:
    project_id: str
    image_bytes: bytes
    content_type: str
    corners: Sequence[tuple[float, float]] | None = None


@dataclass
class DetectionResult:
    model: BuildingModel
    rectified_png: bytes
    metrics: dict[str, float] = field(default_factory=dict)


class ProgressPublisher(ABC):
    """Observer: el pipeline notifica; quien escuche (WebSocket, logs, tests) reacciona."""

    @abstractmethod
    async def publish(self, event: ProgressEventDTO) -> None: ...


class ProgressBroker(ProgressPublisher):
    """Publisher + suscripción por proyecto (lo consume el WebSocket).

    ``subscribe`` entrega primero el historial ya emitido (por si el cliente se
    conecta tarde) y luego los eventos en vivo, hasta el evento final ``done``.
    """

    @abstractmethod
    def subscribe(self, project_id: str) -> AsyncIterator[ProgressEventDTO]: ...

    @abstractmethod
    async def history(self, project_id: str) -> list[ProgressEventDTO]:
        """Eventos ya emitidos (respaldo por polling si el WebSocket no está disponible)."""

    @abstractmethod
    async def reset(self, project_id: str) -> None:
        """Olvida el historial (antes de re-analizar un proyecto)."""


class FloorPlanDetector(ABC):
    """Strategy: cada motor de detección (CV clásica, CNN, SAM, VLM) implementa esto."""

    name: DetectorName

    @abstractmethod
    def supports(self, quality: ImageQuality) -> bool:
        """¿Puede este motor procesar una imagen con esta calidad?"""

    @abstractmethod
    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult: ...


@dataclass(frozen=True)
class ImageQuality:
    width: int
    height: int
    sharpness: float  # varianza del Laplaciano
    contrast: float  # desviación estándar de grises


class PaperDetector(ABC):
    """Detecta la hoja en una foto: 4 esquinas normalizadas 0..1 (TL, TR, BR, BL) o None."""

    @abstractmethod
    def detect(self, data: bytes, content_type: str) -> list[tuple[float, float]] | None: ...


class ProjectRepository(ABC):
    @abstractmethod
    async def add(self, project: Project) -> None: ...

    @abstractmethod
    async def get(self, project_id: str) -> Project | None: ...

    @abstractmethod
    async def list(self) -> list[Project]: ...

    @abstractmethod
    async def save(self, project: Project) -> None: ...

    @abstractmethod
    async def delete(self, project_id: str) -> None: ...


class FileStorage(ABC):
    @abstractmethod
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...


class JobQueue(ABC):
    @abstractmethod
    async def enqueue_analysis(self, project_id: str) -> None: ...
