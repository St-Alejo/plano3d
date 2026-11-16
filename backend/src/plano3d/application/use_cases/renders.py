"""Renders del proyecto: imágenes fotorrealistas que hace Blender en la PC del usuario.

La app de escritorio renderiza con Cycles en la GPU local y sube cada imagen aquí; la API
la guarda en el almacenamiento de archivos (disco o Azure Blob) junto a un índice JSON por
proyecto y avisa a la sala de edición en vivo (``render_added``) para que la galería de la
web la muestre al instante. No hay IA ni costo: solo se guarda y se reparte.
"""

from __future__ import annotations

import json
import secrets
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Final

from plano3d.application.ports import FileStorage, ProjectRepository
from plano3d.application.use_cases.errors import (
    InvalidRenderError,
    ProjectNotFoundError,
    RenderNotFoundError,
)

#: un render 4K en JPEG pesa de 2 a 6 MB; un PNG de 4K puede llegar a 20
MAX_BYTES: Final = 25 * 1024 * 1024
#: renders por proyecto: al pasar el tope se borra el más viejo
MAX_RENDERS: Final = 60
MAX_LABEL: Final = 80

Notify = Callable[[str, dict[str, Any]], None]


@dataclass(frozen=True)
class Render:
    id: str
    label: str
    camera: str
    quality: str
    hour: str
    media_type: str
    size_bytes: int
    width: int
    height: int
    created_at: str

    @property
    def key(self) -> str:
        return render_key(self.id, self.media_type)


def render_key(render_id: str, media_type: str) -> str:
    return f"renders/{render_id}.{'png' if media_type == 'image/png' else 'jpg'}"


def _index_key(project_id: str) -> str:
    return f"renders/{project_id}/index.json"


def sniff(data: bytes) -> tuple[str, int, int]:
    """Tipo y tamaño en píxeles de un JPEG o PNG (sin decodificar la imagen)."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return "image/png", int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data[:3] == b"\xff\xd8\xff":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            size = int.from_bytes(data[i + 2 : i + 4], "big")
            # SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC): ahí van alto y ancho
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h = int.from_bytes(data[i + 5 : i + 7], "big")
                w = int.from_bytes(data[i + 7 : i + 9], "big")
                return "image/jpeg", w, h
            i += 2 + size
        return "image/jpeg", 0, 0
    raise InvalidRenderError("El render debe ser una imagen JPEG o PNG")


class RenderGallery:
    """Casos de uso de la galería de renders de un proyecto (agregar, listar, leer)."""

    def __init__(
        self, repo: ProjectRepository, storage: FileStorage, notify: Notify | None = None
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._notify = notify

    async def _require(self, project_id: str) -> None:
        if await self._repo.get(project_id) is None:
            raise ProjectNotFoundError(project_id)

    async def gallery(self, project_id: str) -> list[Render]:
        await self._require(project_id)
        return await self._read_index(project_id)

    async def add(
        self,
        project_id: str,
        image: bytes,
        label: str,
        camera: str = "",
        quality: str = "",
        hour: str = "",
    ) -> Render:
        await self._require(project_id)
        if not image:
            raise InvalidRenderError("El render llegó vacío")
        if len(image) > MAX_BYTES:
            raise InvalidRenderError(f"El render pesa más de {MAX_BYTES // (1024 * 1024)} MB")
        media, width, height = sniff(image)
        render = Render(
            id=f"{project_id}-{secrets.token_hex(6)}",
            label=(label.strip() or camera.strip() or "Render")[:MAX_LABEL],
            camera=camera.strip()[:MAX_LABEL],
            quality=quality.strip()[:20],
            hour=hour.strip()[:20],
            media_type=media,
            size_bytes=len(image),
            width=width,
            height=height,
            created_at=datetime.now(UTC).isoformat(timespec="seconds"),
        )
        await self._storage.put(render.key, image, media)
        index = [*await self._read_index(project_id), render]
        for old in index[:-MAX_RENDERS]:
            await self._storage.delete(old.key)
        index = index[-MAX_RENDERS:]
        await self._write_index(project_id, index)
        if self._notify is not None:
            self._notify(project_id, {"type": "render_added", "render": asdict(render)})
        return render

    async def image(self, project_id: str, render_id: str) -> tuple[bytes, str]:
        found = next((r for r in await self.gallery(project_id) if r.id == render_id), None)
        if found is None:
            raise RenderNotFoundError("Ese render no existe")
        return await self._storage.get(found.key), found.media_type

    async def purge(self, project_id: str) -> None:
        """Borra los renders de un proyecto (al borrarlo)."""
        for r in await self._read_index(project_id):
            await self._storage.delete(r.key)
        await self._storage.delete(_index_key(project_id))

    async def _read_index(self, project_id: str) -> list[Render]:
        try:
            raw = await self._storage.get(_index_key(project_id))
        except FileNotFoundError:
            return []
        fields = set(Render.__dataclass_fields__)
        return [
            Render(**{k: v for k, v in item.items() if k in fields}) for item in json.loads(raw)
        ]

    async def _write_index(self, project_id: str, index: list[Render]) -> None:
        data = json.dumps([asdict(r) for r in index], ensure_ascii=False).encode("utf-8")
        await self._storage.put(_index_key(project_id), data, "application/json")
