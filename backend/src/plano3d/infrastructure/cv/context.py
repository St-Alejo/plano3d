"""Contexto que viaja por las etapas del pipeline de visión clásica (coordenadas en píxeles)."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt

from plano3d.domain import BuildingModel

Img = npt.NDArray[np.uint8]


def as_u8(a: object) -> Img:
    """OpenCV declara sus retornos con dtype genérico; aquí se fija a uint8 (sin copiar)."""
    return np.asarray(a, dtype=np.uint8)


@dataclass
class PxOpening:
    offset: float  # px desde el inicio del segmento
    width: float
    kind: str  # "door" | "window"
    confidence: float


@dataclass
class Segment:
    """Muro detectado: línea central + grosor, en píxeles de la imagen rectificada."""

    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float
    openings: list[PxOpening] = field(default_factory=list)
    confidence: float = 0.8

    @property
    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    @property
    def direction(self) -> tuple[float, float]:
        n = self.length or 1.0
        return (self.x2 - self.x1) / n, (self.y2 - self.y1) / n

    @property
    def angle(self) -> float:
        """Ángulo de la recta en [0, 180)."""
        return math.degrees(math.atan2(self.y2 - self.y1, self.x2 - self.x1)) % 180.0

    def endpoints(self) -> tuple[tuple[float, float], tuple[float, float]]:
        return (self.x1, self.y1), (self.x2, self.y2)


@dataclass
class PxRoom:
    polygon: npt.NDArray[np.float64]  # (N, 2)
    confidence: float
    label: str


@dataclass
class CVContext:
    project_id: str
    image_bytes: bytes
    content_type: str
    #: esquinas del papel normalizadas a [0,1] (TL, TR, BR, BL), elegidas por el usuario
    corners: Sequence[tuple[float, float]] | None = None
    #: (m/px, confianza) conocidos de antemano (ver ``DetectionRequest.scale_hint``)
    scale_hint: tuple[float, float] | None = None

    original: Img | None = None
    rectified: Img | None = None
    #: homografía 3x3 de píxeles de la imagen SUBIDA → píxeles de ``rectified``. Cada etapa
    #: que mueve la imagen (reducción, rectificación, enderezado) la compone; sirve para
    #: llevar anotaciones, cotas o la verdad de terreno de un sistema al otro.
    transform: npt.NDArray[np.float64] = field(default_factory=lambda: np.eye(3))
    paper_detected: bool = False
    ink: Img | None = None  # 255 = tinta
    wall_mask: Img | None = None  # 255 = muro
    wall_thickness_px: float = 0.0
    segments: list[Segment] = field(default_factory=list)
    meters_per_pixel: float = 0.0
    scale_confidence: float = 0.0
    rooms: list[PxRoom] = field(default_factory=list)
    model: BuildingModel | None = None
    metrics: dict[str, float] = field(default_factory=dict)

    def then(self, m: npt.ArrayLike) -> None:
        """Compone una transformación (3x3, o afín 2x3) aplicada a la imagen de trabajo."""
        a = np.asarray(m, np.float64)
        if a.shape == (2, 3):
            a = np.vstack([a, [0.0, 0.0, 1.0]])
        self.transform = a @ self.transform

    def require[T](self, value: T | None, name: str) -> T:
        if value is None:
            raise RuntimeError(f"Falta '{name}': ¿se ejecutó la etapa anterior?")
        return value
