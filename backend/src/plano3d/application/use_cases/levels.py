"""Pisos de un proyecto: sumar uno desde otro archivo o copiar uno existente."""

from __future__ import annotations

from plano3d.application.dto import ProgressEventDTO
from plano3d.application.ports import DetectionRequest, ProgressPublisher, ProjectRepository
from plano3d.application.use_cases.analyze import DetectorSelector
from plano3d.application.use_cases.projects import _check_upload, _load, commit_model
from plano3d.domain import BuildingModel, Project
from plano3d.domain.errors import DomainError
from plano3d.domain.furnish import furnish
from plano3d.domain.stacking import stack_level


class _Silent(ProgressPublisher):
    """La detección de un piso extra corre dentro de la petición: no hay a quién avisar."""

    async def publish(self, event: ProgressEventDTO) -> None:
        return None


def _model(project: Project) -> BuildingModel:
    if project.model is None:
        raise DomainError("El proyecto aún no tiene modelo")
    return project.model


class AddLevelFromFile:
    """Otro plano (foto, PDF o DXF) del mismo edificio se detecta y se apila como un piso
    más, alineado con el de abajo por la retícula de columnas."""

    def __init__(self, repo: ProjectRepository, selector: DetectorSelector) -> None:
        self._repo = repo
        self._selector = selector

    async def execute(
        self,
        project_id: str,
        data: bytes,
        content_type: str,
        name: str | None = None,
        expected_revision: int | None = None,
    ) -> Project:
        project = await _load(self._repo, project_id)
        model = _model(project)
        _check_upload(data, content_type)
        detector = self._selector.choose(data, content_type)
        result = await detector.detect(
            DetectionRequest(project_id, data, content_type, None), _Silent()
        )
        if not result.model.levels:
            raise DomainError("No se encontró ninguna planta en el archivo")
        level = result.model.levels[0]
        stacked = stack_level(model, level, name)
        added = stacked.levels[-1]
        return await commit_model(
            self._repo, project, stacked, f"Piso agregado: {added.name}", expected_revision
        )


class FurnishLevels:
    """Completa los muebles que faltan (de un piso o de todos) según el tipo de ambiente.

    Lo que ya está (lo leído del plano o lo puesto a mano) no se mueve; si no falta nada,
    no se crea una revisión."""

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(
        self,
        project_id: str,
        level_id: str | None = None,
        expected_revision: int | None = None,
    ) -> Project:
        project = await _load(self._repo, project_id)
        model = _model(project)
        targets = [model.level(level_id)] if level_id else list(model.levels)
        changed = model
        names: list[str] = []
        for lv in targets:
            done = furnish(lv)
            if done is not lv:
                changed = changed.with_level(done)
                names.append(lv.name)
        if not names:
            return project
        return await commit_model(
            self._repo, project, changed, f"Amoblado: {', '.join(names)}", expected_revision
        )


class DuplicateLevel:
    """Copia de un piso encima del último (pisos tipo: el 3 igual al 2)."""

    def __init__(self, repo: ProjectRepository) -> None:
        self._repo = repo

    async def execute(
        self,
        project_id: str,
        level_id: str,
        name: str | None = None,
        expected_revision: int | None = None,
    ) -> Project:
        project = await _load(self._repo, project_id)
        model = _model(project)
        source = model.level(level_id)
        # la copia ya está en el marco del edificio: no se realinea
        stacked = stack_level(model, source, name, align=False)
        added = stacked.levels[-1]
        return await commit_model(
            self._repo,
            project,
            stacked,
            f"Piso duplicado: {source.name} → {added.name}",
            expected_revision,
        )
