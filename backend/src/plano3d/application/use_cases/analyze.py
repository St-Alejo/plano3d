"""Caso de uso central: analizar el plano y producir el BuildingModel."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import replace

from plano3d.application.dto import ProgressEventDTO
from plano3d.application.ports import (
    DetectionRequest,
    FileStorage,
    FloorPlanDetector,
    ImageQuality,
    ProgressPublisher,
    ProjectRepository,
)
from plano3d.application.use_cases.errors import NoDetectorAvailableError, ProjectNotFoundError
from plano3d.application.use_cases.projects import DETECTION_SUMMARY
from plano3d.domain import ModelRevision, SourceImage

log = logging.getLogger(__name__)

CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "pdf": "application/pdf",
    "dxf": "application/dxf",
}


class ImageInspector(ABC):
    """Puerto: mide la calidad de la imagen para elegir estrategia."""

    @abstractmethod
    def inspect(self, data: bytes, content_type: str) -> ImageQuality: ...


class DetectorSelector:
    """Elige la estrategia de detección.

    Los detectores se pasan en orden de preferencia; gana el primero que declare
    soportar la calidad de la imagen. El usuario puede forzar uno por nombre.
    """

    def __init__(self, detectors: Sequence[FloorPlanDetector], inspector: ImageInspector) -> None:
        if not detectors:
            raise ValueError("Se necesita al menos un detector")
        self._detectors = list(detectors)
        self._inspector = inspector

    @property
    def available(self) -> list[str]:
        return [d.name for d in self._detectors]

    def choose(
        self, data: bytes, content_type: str, preferred: str | None = None
    ) -> FloorPlanDetector:
        if preferred is not None:
            for d in self._detectors:
                if d.name == preferred:
                    return d
            raise NoDetectorAvailableError(f"Detector {preferred!r} no está instalado")
        quality: ImageQuality | None = None
        for d in self._detectors:
            if not d.accepts(content_type, data):
                continue
            if not d.inspects_quality:
                return d
            if quality is None:
                quality = self._inspector.inspect(data, content_type)
            if d.supports(quality):
                return d
        raise NoDetectorAvailableError("Ningún detector soporta este archivo")


class AnalyzeFloorPlan:
    def __init__(
        self,
        repo: ProjectRepository,
        storage: FileStorage,
        selector: DetectorSelector,
        progress: ProgressPublisher,
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._selector = selector
        self._progress = progress

    async def execute(self, project_id: str) -> None:
        project = await self._repo.get(project_id)
        if project is None:
            raise ProjectNotFoundError(project_id)
        project.start_processing()
        await self._repo.save(project)

        ext = project.original_image_key.rsplit(".", 1)[-1]
        content_type = CONTENT_TYPES.get(ext, "image/jpeg")
        try:
            data = await self._storage.get(project.original_image_key)
            detector = self._selector.choose(data, content_type)
            log.info("Proyecto %s: usando detector %s", project_id, detector.name)
            result = await detector.detect(
                DetectionRequest(project_id, data, content_type, project.corners),
                self._progress,
            )
            key = f"rectified/{project_id}.png"
            await self._storage.put(key, result.rectified_png, "image/png")
            src = result.model.source_image
            model = replace(
                result.model,
                source_image=SourceImage(key, src.width_px, src.height_px) if src else None,
            )
            project.complete(model)
            await self._repo.save(project)
            await self._repo.add_revision(
                ModelRevision(
                    project.id, project.revision, model, f"{DETECTION_SUMMARY} ({detector.name})"
                )
            )
            await self._progress.publish(
                ProgressEventDTO(
                    project_id=project_id,
                    stage="done",
                    status="completed",
                    index=0,
                    total=0,
                    metrics={**result.metrics, "total_area_m2": model.total_area},
                    message=f"Detector: {detector.name}",
                )
            )
        except Exception as exc:
            log.exception("Falló el análisis de %s", project_id)
            project.fail(str(exc))
            await self._repo.save(project)
            await self._progress.publish(
                ProgressEventDTO(
                    project_id=project_id,
                    stage="done",
                    status="failed",
                    index=0,
                    total=0,
                    message=str(exc),
                )
            )
