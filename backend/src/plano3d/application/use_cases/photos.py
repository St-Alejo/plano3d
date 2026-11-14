"""Fotos realistas del proyecto: capturas del modelo 3D → fotos con IA de imágenes.

El navegador manda una captura por vista (la cámara la pone él, con el modelo ya
armado); aquí se arma la instrucción de cada foto, se cuida el tope de gasto y se piden
todas a la vez. La IA solo "viste" la captura: la geometría (pisos, vanos, proporciones)
sale del modelo del usuario, no se inventa.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from plano3d.application.ports import PhotoGenerator, ProjectRepository
from plano3d.application.use_cases.errors import (
    InvalidPhotoRequestError,
    PhotosUnavailableError,
    ProjectNotFoundError,
)

log = logging.getLogger(__name__)

MAX_PHOTOS = 5
MAX_BYTES = 4 * 1024 * 1024

#: vista → (rótulo, escena que se pide)
VIEWS: dict[str, tuple[str, str]] = {
    "calle": (
        "Desde la calle",
        "Foto desde el andén de enfrente a la altura de los ojos, de día, "
        "con cielo despejado y luz suave.",
    ),
    "esquina": (
        "Al atardecer",
        "Foto aérea baja a tres cuartos, al atardecer, con luz dorada y sombras largas.",
    ),
    "costado": (
        "Desde el otro costado",
        "Foto a tres cuartos desde el otro costado, en la mañana, con luz fresca y pocas nubes.",
    ),
    "noche": (
        "De noche",
        "Foto desde la calle en la hora azul, recién anochecido, con las luces de adentro "
        "encendidas en tono cálido, las luces de la fachada prendidas y el cielo azul profundo.",
    ),
    "interior": (
        "Por dentro",
        "Foto de interiores del espacio que se ve, terminado y amoblado con buen gusto: "
        "pisos de madera clara o porcelanato, paredes pintadas y luz natural por las ventanas.",
    ),
}

BASE = (
    "Convierte esta captura de un modelo 3D en una fotografía arquitectónica real y "
    "fotorrealista de la misma vivienda. Conserva exactamente la geometría: el mismo número "
    "de pisos, la posición, forma y tamaño de cada ventana, puerta y portón, las proporciones "
    "y el mismo encuadre de cámara; no agregues pisos, balcones ni volúmenes. "
    "Respeta los colores y materiales que se ven en la captura y dales textura real "
    "(pañete, pintura, ladrillo, madera, aluminio, vidrio con reflejos). "
    "Si el último piso se ve abierto por arriba, ciérralo con una cubierta plana con antepecho. "
    "Entorno: barrio residencial colombiano con andén, calle y algo de vegetación. "
    "Lente de 35 mm, sin texto, sin marcas de agua, sin personas."
)


@dataclass(frozen=True)
class Shot:
    view: str
    image: bytes


@dataclass(frozen=True)
class Photo:
    view: str
    label: str
    jpeg: bytes


@dataclass(frozen=True)
class PhotoBatch:
    photos: list[Photo]
    failed: int
    remaining_usd: float


def _is_image(data: bytes) -> bool:
    return data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")


def build_prompt(view: str, levels: int, facade: str) -> str:
    """Instrucción de una vista: la base + la escena + lo que se sabe del proyecto."""
    extra = [VIEWS[view][1]]
    if view != "interior" and levels:
        extra.append(f"La casa tiene {levels} piso{'s' if levels != 1 else ''}.")
    if facade.strip():
        extra.append(f"Estilo de fachada: {facade.strip()[:60]}.")
    return f"{BASE} {' '.join(extra)}"


class GeneratePhotos:
    def __init__(self, repo: ProjectRepository, generator: PhotoGenerator | None) -> None:
        self._repo = repo
        self._gen = generator

    async def execute(self, project_id: str, shots: list[Shot], facade: str = "") -> PhotoBatch:
        project = await self._repo.get(project_id)
        if project is None:
            raise ProjectNotFoundError(project_id)
        if self._gen is None:
            raise PhotosUnavailableError(
                "La generación de fotos con IA no está configurada en este servidor"
            )
        if not shots or len(shots) > MAX_PHOTOS:
            raise InvalidPhotoRequestError(f"Envía entre 1 y {MAX_PHOTOS} capturas")
        for s in shots:
            if s.view not in VIEWS:
                raise InvalidPhotoRequestError(f"Vista desconocida: {s.view}")
            if len(s.image) > MAX_BYTES or not _is_image(s.image):
                raise InvalidPhotoRequestError("Cada captura debe ser un JPEG o PNG de máximo 4 MB")
        if self._gen.remaining_usd() < self._gen.cost_per_photo * len(shots):
            raise PhotosUnavailableError("Se acabó el presupuesto para fotos con IA")

        levels = len(project.model.levels) if project.model else 0
        results = await asyncio.gather(
            *(self._gen.generate(s.image, build_prompt(s.view, levels, facade)) for s in shots),
            return_exceptions=True,
        )
        photos: list[Photo] = []
        errors: list[BaseException] = []
        for s, r in zip(shots, results, strict=True):
            if isinstance(r, BaseException):
                errors.append(r)
                log.warning("La foto %s falló: %s", s.view, r)
            else:
                photos.append(Photo(s.view, VIEWS[s.view][0], r))
        if not photos:
            first = errors[0]
            if isinstance(first, PhotosUnavailableError):
                raise first
            raise PhotosUnavailableError("No se pudieron generar las fotos; intenta de nuevo")
        return PhotoBatch(photos, len(errors), self._gen.remaining_usd())
