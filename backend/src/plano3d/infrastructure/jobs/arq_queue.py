from __future__ import annotations

from arq import ArqRedis

from plano3d.application.ports import JobQueue

ANALYZE_JOB = "analyze_floor_plan"


class ArqJobQueue(JobQueue):
    def __init__(self, pool: ArqRedis) -> None:
        self._pool = pool

    async def enqueue_analysis(self, project_id: str) -> None:
        # _job_id evita encolar dos veces el mismo análisis
        await self._pool.enqueue_job(ANALYZE_JOB, project_id, _job_id=f"analyze:{project_id}")
