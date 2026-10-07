"""Puertos (interfaces) del hexágono. Los casos de uso dependen SOLO de esto.

Cada puerto tiene al menos dos adaptadores: uno real (infraestructura) y uno en
memoria para tests, lo que demuestra que el dominio no conoce los detalles.
"""

from __future__ import annotations

import builtins
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import numpy.typing as npt

from plano3d.application.dto import ProgressEventDTO
from plano3d.domain import BuildingModel, ModelRevision, Project

Image = npt.NDArray[np.uint8]
DetectorName = Literal[
    "classic-cv",
    "raster-vector",
    "cnn-cubicasa",
    "sam-rooms",
    "vlm-semantic",
    "vector-dxf",
    "vector-pdf",
]

#: entradas raster: lo que entiende un detector que trabaja sobre la imagen
RASTER_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "application/pdf"})


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
    #: homografía 3x3 (por filas) de píxeles de la imagen SUBIDA → píxeles de la rectificada.
    #: Permite llevar el modelo (metros = px rectificados por escala) de vuelta a la imagen
    #: original: evaluación contra verdad anotada y datos de entrenamiento alineados.
    image_transform: tuple[float, ...] | None = None


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
    #: si es False, el selector no mide la calidad de imagen (p. ej. un DXF no es imagen)
    inspects_quality: bool = True

    def accepts(self, content_type: str, data: bytes) -> bool:
        """¿Entiende este motor el archivo? Por defecto: imágenes y PDF (rasterizado)."""
        return content_type in RASTER_TYPES

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
    async def save(self, project: Project, expected_revision: int | None = None) -> None:
        """Guarda. Con ``expected_revision`` falla (ConcurrencyError) si la revisión
        almacenada no es esa: la comprobación es atómica en la base de datos."""

    @abstractmethod
    async def delete(self, project_id: str) -> None: ...

    @abstractmethod
    async def add_revision(self, revision: ModelRevision) -> None: ...

    @abstractmethod
    async def list_revisions(self, project_id: str) -> builtins.list[ModelRevision]:
        """Más reciente primero."""

    @abstractmethod
    async def get_revision(self, project_id: str, number: int) -> ModelRevision | None: ...


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


@dataclass(frozen=True)
class ReadText:
    """Lo que un lector reconoció en un recorte: texto y confianza (0..1)."""

    text: str
    confidence: float


class TextReader(ABC):
    """Strategy: reconoce el texto de recortes ya enderezados (cotas, nombres).

    Se le pasan recortes, nunca la hoja entera: así un OCR local es rápido y un modelo
    de visión (Claude) no pierde resolución al reducir la imagen.
    """

    name: str

    @abstractmethod
    def read(self, crops: Sequence[Image]) -> builtins.list[ReadText]:
        """Un resultado por recorte, en el mismo orden (texto vacío si no leyó nada)."""


@dataclass(frozen=True)
class ShotReport:
    """Calidad de una foto del plano y avisos para repetirla."""

    sharpness: float
    glare: float
    width: int
    height: int
    paper_found: bool
    warnings: tuple[str, ...] = ()


class CaptureInspector(ABC):
    @abstractmethod
    def check(self, data: bytes, content_type: str) -> ShotReport: ...


class ImageStitcher(ABC):
    """Une varias fotos parciales de una hoja grande en una sola imagen (PNG)."""

    @abstractmethod
    def stitch(self, images: Sequence[bytes]) -> bytes: ...
