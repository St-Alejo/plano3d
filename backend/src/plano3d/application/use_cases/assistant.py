"""Chat del editor: respaldo con un asistente cuando el intérprete local no entiende."""

from __future__ import annotations

from plano3d.application.ports import AssistantReply, PlanAssistant, ProjectRepository
from plano3d.application.use_cases.errors import AssistantUnavailableError, ProjectNotFoundError

MAX_MESSAGE = 1000
MAX_CONTEXT = 6000


class InterpretChat:
    def __init__(self, repo: ProjectRepository, assistant: PlanAssistant | None) -> None:
        self._repo = repo
        self._assistant = assistant

    async def execute(self, project_id: str, message: str, context: str) -> AssistantReply:
        if await self._repo.get(project_id) is None:
            raise ProjectNotFoundError(project_id)
        if self._assistant is None:
            raise AssistantUnavailableError(
                "El asistente con IA no está disponible en este servidor"
            )
        return await self._assistant.interpret(message[:MAX_MESSAGE], context[:MAX_CONTEXT])
