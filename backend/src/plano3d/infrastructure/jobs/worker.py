"""Worker arq: ejecuta los análisis fuera del proceso de la API.

Arranque: ``arq plano3d.infrastructure.jobs.worker.WorkerSettings``
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

from arq.connections import RedisSettings

from plano3d.config import Settings
from plano3d.container import Container, build_container

settings = Settings()
logging.basicConfig(level=settings.log_level)


async def startup(ctx: dict[str, Any]) -> None:
    ctx["container"] = await build_container(settings.model_copy(update={"mode": "full"}))


async def shutdown(ctx: dict[str, Any]) -> None:
    container: Container = ctx["container"]
    await container.aclose()


async def analyze_floor_plan(ctx: dict[str, Any], project_id: str) -> None:
    container: Container = ctx["container"]
    await container.analyze.execute(project_id)


class WorkerSettings:
    functions: ClassVar[list[Any]] = [analyze_floor_plan]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 2
    job_timeout = 300
    keep_result = 0
