"""Patrón Pipeline / Chain of Responsibility genérico.

Cada etapa recibe un contexto, lo enriquece y lo pasa a la siguiente. El pipeline
se encarga de lo transversal: medir tiempos, publicar progreso (Observer) y
envolver errores con el nombre de la etapa que falló.
"""

from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence

from plano3d.application.dto import BuildingModelDTO, ProgressEventDTO
from plano3d.application.ports import ProgressPublisher


class PipelineStage[Ctx](ABC):
    #: identificador estable (lo usa el frontend para el stepper)
    key: str
    #: nombre legible
    title: str

    @abstractmethod
    def run(self, ctx: Ctx) -> Ctx:
        """Trabajo síncrono (CPU). El pipeline lo ejecuta fuera del event loop."""

    def metrics(self, ctx: Ctx) -> dict[str, float]:
        return {}


class StageFailedError(Exception):
    def __init__(self, stage: str, cause: Exception) -> None:
        super().__init__(f"La etapa '{stage}' falló: {cause}")
        self.stage = stage
        self.cause = cause


class Pipeline[Ctx]:
    def __init__(
        self,
        stages: Sequence[PipelineStage[Ctx]],
        preview: Callable[[Ctx], BuildingModelDTO | None] | None = None,
    ) -> None:
        if not stages:
            raise ValueError("Un pipeline necesita al menos una etapa")
        keys = [s.key for s in stages]
        if len(keys) != len(set(keys)):
            raise ValueError("Las claves de etapa deben ser únicas")
        self._stages = list(stages)
        self._preview = preview

    @property
    def stage_keys(self) -> list[str]:
        return [s.key for s in self._stages]

    async def run(self, ctx: Ctx, project_id: str, progress: ProgressPublisher) -> Ctx:
        total = len(self._stages)
        for index, stage in enumerate(self._stages):
            await progress.publish(
                ProgressEventDTO(
                    project_id=project_id,
                    stage=stage.key,
                    status="started",
                    index=index,
                    total=total,
                    message=stage.title,
                )
            )
            t0 = time.perf_counter()
            try:
                ctx = await asyncio.to_thread(stage.run, ctx)
            except Exception as exc:
                await progress.publish(
                    ProgressEventDTO(
                        project_id=project_id,
                        stage=stage.key,
                        status="failed",
                        index=index,
                        total=total,
                        message=str(exc),
                    )
                )
                raise StageFailedError(stage.key, exc) from exc
            await progress.publish(
                ProgressEventDTO(
                    project_id=project_id,
                    stage=stage.key,
                    status="completed",
                    index=index,
                    total=total,
                    elapsed_ms=(time.perf_counter() - t0) * 1000,
                    metrics=stage.metrics(ctx),
                    message=stage.title,
                    preview=self._preview(ctx) if self._preview else None,
                )
            )
        return ctx
