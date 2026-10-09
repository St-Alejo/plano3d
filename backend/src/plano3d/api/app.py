"""Adaptador de entrada HTTP/WebSocket (FastAPI). Traduce HTTP ⇄ casos de uso."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from plano3d.application.dto import (
    BlankProjectDTO,
    BuildingModelDTO,
    CalibrateScaleDTO,
    CaptureCheckDTO,
    CornersDTO,
    CorrectionStatsDTO,
    ProgressEventDTO,
    ProjectCreatedDTO,
    ProjectDTO,
    ProjectSummaryDTO,
    ReanalyzeDTO,
    RevisionDTO,
    SolveReportDTO,
    SolveResultDTO,
    model_from_dto,
    model_to_dto,
    project_to_dto,
    project_to_summary,
    revision_to_dto,
    stats_to_dto,
)
from plano3d.application.use_cases.errors import (
    FileTooLargeError,
    NoDetectorAvailableError,
    ProjectNotFoundError,
    UnsupportedFileError,
)
from plano3d.application.use_cases.projects import normalize_content_type
from plano3d.config import Settings
from plano3d.container import Container, build_container
from plano3d.domain import Point2D
from plano3d.domain.errors import (
    ConcurrencyError,
    DomainError,
    EntityNotFoundError,
    InvalidStateTransitionError,
)

log = logging.getLogger(__name__)


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


ContainerDep = Annotated[Container, Depends(get_container)]


def _parse_corners(raw: str | None) -> list[tuple[float, float]] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        corners = [(float(x), float(y)) for x, y in data]
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "corners debe ser JSON: [[x,y] x4] normalizado 0..1") from exc
    if len(corners) != 4 or not all(0 <= v <= 1 for c in corners for v in c):
        raise HTTPException(422, "Se necesitan 4 esquinas normalizadas entre 0 y 1")
    return corners


router = APIRouter(prefix="/api")


@router.get("/health", tags=["sistema"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/corners", response_model=CornersDTO, tags=["captura"])
async def suggest_corners(
    c: ContainerDep,
    file: Annotated[UploadFile, File(description="Foto del plano")],
) -> CornersDTO:
    """Detecta la hoja en la foto para precargar el ajuste manual de esquinas."""
    data = await file.read()
    ctype = normalize_content_type(file.content_type or "", file.filename)
    corners = await asyncio.to_thread(c.suggest_corners.execute, data, ctype)
    return CornersDTO(corners=corners)


@router.post("/capture/check", response_model=CaptureCheckDTO, tags=["captura"])
async def check_capture(
    c: ContainerDep,
    file: Annotated[UploadFile, File(description="Foto del plano")],
) -> CaptureCheckDTO:
    """¿La foto sirve? Avisa si está movida, con reflejo o con poca resolución."""
    data = await file.read()
    ctype = normalize_content_type(file.content_type or "", file.filename)
    r = await asyncio.to_thread(c.check_capture.execute, data, ctype)
    return CaptureCheckDTO(
        ok=not r.warnings,
        sharpness=r.sharpness,
        glare=r.glare,
        width=r.width,
        height=r.height,
        paper_found=r.paper_found,
        warnings=list(r.warnings),
    )


@router.get("/projects", response_model=list[ProjectSummaryDTO], tags=["proyectos"])
async def list_projects(c: ContainerDep) -> list[ProjectSummaryDTO]:
    return [project_to_summary(p) for p in await c.list_projects.execute()]


@router.post(
    "/projects",
    response_model=ProjectCreatedDTO,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["proyectos"],
)
async def create_project(
    c: ContainerDep,
    file: Annotated[UploadFile, File(description="Foto, imagen, PDF o DXF del plano")],
    name: Annotated[str, Form()] = "Plano sin nombre",
    corners: Annotated[str | None, Form(description="JSON [[x,y] x4] normalizado")] = None,
    extra: Annotated[
        list[UploadFile] | None,
        File(description="Más fotos de la misma hoja, de izquierda a derecha (se unen)"),
    ] = None,
) -> ProjectCreatedDTO:
    data = await file.read()
    more = [
        (await f.read(), normalize_content_type(f.content_type or "", f.filename))
        for f in (extra or [])
    ]
    project = await c.create_project.execute(
        name,
        data,
        normalize_content_type(file.content_type or "", file.filename),
        _parse_corners(corners),
        more,
    )
    return ProjectCreatedDTO(id=project.id, status=project.status)


@router.post(
    "/projects/blank",
    response_model=ProjectDTO,
    status_code=status.HTTP_201_CREATED,
    tags=["proyectos"],
)
async def create_blank_project(body: BlankProjectDTO, c: ContainerDep) -> ProjectDTO:
    """Plano desde cero: sin foto, listo para dibujar en el editor o con el chat."""
    return project_to_dto(await c.create_blank_project.execute(body.name))


def _etag(revision: int) -> str:
    return f'"{revision}"'


def _parse_if_match(value: str | None) -> int | None:
    """If-Match: "7" (o W/"7") → 7. Ausente o "*" → sin comprobación."""
    if value is None or value.strip() == "*":
        return None
    raw = value.strip().removeprefix("W/").strip('"')
    try:
        return int(raw)
    except ValueError as exc:
        raise HTTPException(
            400, 'If-Match debe ser la revisión entre comillas, p. ej. "3"'
        ) from exc


IfMatch = Annotated[
    str | None,
    Header(alias="If-Match", description="Revisión que se editó; si cambió, responde 409"),
]


@router.get("/projects/{project_id}", response_model=ProjectDTO, tags=["proyectos"])
async def get_project(project_id: str, c: ContainerDep, response: Response) -> ProjectDTO:
    project = await c.get_project.execute(project_id)
    response.headers["ETag"] = _etag(project.revision)
    return project_to_dto(project)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["proyectos"])
async def delete_project(project_id: str, c: ContainerDep) -> Response:
    await c.delete_project.execute(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/projects/{project_id}/model",
    response_model=ProjectDTO,
    responses={409: {"description": "Otra persona guardó una versión más nueva"}},
    tags=["modelo"],
)
async def update_model(
    project_id: str,
    body: BuildingModelDTO,
    c: ContainerDep,
    response: Response,
    if_match: IfMatch = None,
    summary: Annotated[str, Query(max_length=200)] = "Corrección manual",
) -> ProjectDTO:
    if body.project_id != project_id:
        raise HTTPException(422, "project_id del cuerpo no coincide con la URL")
    project = await c.update_model.execute(
        project_id, model_from_dto(body), _parse_if_match(if_match), summary
    )
    response.headers["ETag"] = _etag(project.revision)
    return project_to_dto(project)


@router.get("/projects/{project_id}/revisions", response_model=list[RevisionDTO], tags=["modelo"])
async def list_revisions(project_id: str, c: ContainerDep) -> list[RevisionDTO]:
    return [revision_to_dto(r) for r in await c.list_revisions.execute(project_id)]


@router.get(
    "/projects/{project_id}/revisions/{number}", response_model=BuildingModelDTO, tags=["modelo"]
)
async def get_revision(project_id: str, number: int, c: ContainerDep) -> BuildingModelDTO:
    return model_to_dto((await c.get_revision.execute(project_id, number)).model)


@router.post(
    "/projects/{project_id}/revisions/{number}/restore",
    response_model=ProjectDTO,
    tags=["modelo"],
)
async def restore_revision(
    project_id: str, number: int, c: ContainerDep, response: Response, if_match: IfMatch = None
) -> ProjectDTO:
    project = await c.restore_revision.execute(project_id, number, _parse_if_match(if_match))
    response.headers["ETag"] = _etag(project.revision)
    return project_to_dto(project)


@router.get("/projects/{project_id}/quality", response_model=CorrectionStatsDTO, tags=["modelo"])
async def correction_quality(project_id: str, c: ContainerDep) -> CorrectionStatsDTO:
    return stats_to_dto(await c.correction_stats.execute(project_id))


@router.post("/projects/{project_id}/solve", response_model=SolveResultDTO, tags=["modelo"])
async def solve_dimensions(
    project_id: str,
    response: Response,
    c: ContainerDep,
    if_match: Annotated[str | None, Header()] = None,
) -> SolveResultDTO:
    """Ajusta los muros a las cotas del plano (las medidas escritas mandan)."""
    project, report = await c.solve_dimensions.execute(project_id, _parse_if_match(if_match))
    response.headers["ETag"] = _etag(project.revision)
    return SolveResultDTO(
        project=project_to_dto(project),
        report=SolveReportDTO(
            dims_exact=report.dims_exact,
            dims_conflict=report.dims_conflict,
            dims_unlinked=report.dims_unlinked,
            walls_exact=report.walls_exact,
            max_residual=round(report.max_residual, 4),
            moved_max=round(report.moved_max, 4),
            conflicts=report.conflicts,
        ),
    )


@router.post("/projects/{project_id}/scale", response_model=ProjectDTO, tags=["modelo"])
async def calibrate_scale(project_id: str, body: CalibrateScaleDTO, c: ContainerDep) -> ProjectDTO:
    project = await c.calibrate_scale.execute(
        project_id, Point2D(body.a.x, body.a.y), Point2D(body.b.x, body.b.y), body.meters
    )
    return project_to_dto(project)


@router.post(
    "/projects/{project_id}/reanalyze",
    response_model=ProjectCreatedDTO,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["proyectos"],
)
async def reanalyze(
    project_id: str,
    c: ContainerDep,
    body: ReanalyzeDTO | None = None,
) -> ProjectCreatedDTO:
    corners = body.corners if body else None
    if corners is not None and not all(0 <= v <= 1 for c in corners for v in c):
        raise HTTPException(422, "Las esquinas deben estar normalizadas entre 0 y 1")
    project = await c.reanalyze.execute(project_id, corners)
    return ProjectCreatedDTO(id=project.id, status=project.status)


@router.get(
    "/projects/{project_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/png": {}, "image/jpeg": {}}}},
    tags=["proyectos"],
)
async def get_image(
    project_id: str,
    c: ContainerDep,
    kind: Annotated[str, Query(pattern="^(original|rectified)$")] = "rectified",
) -> Response:
    project = await c.get_project.execute(project_id)
    if kind == "rectified" and project.model and project.model.source_image:
        key, media = project.model.source_image.key, "image/png"
    elif not project.has_source:
        raise HTTPException(404, "Este plano se dibujó desde cero: no tiene imagen")
    else:
        key = project.original_image_key
        ext = key.rsplit(".", 1)[-1]
        media = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(
            ext, "application/pdf"
        )
    try:
        data = await c.storage.get(key)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Imagen no disponible") from exc
    return Response(data, media_type=media, headers={"Cache-Control": "private, max-age=300"})


@router.get(
    "/projects/{project_id}/progress", response_model=list[ProgressEventDTO], tags=["proyectos"]
)
async def get_progress(project_id: str, c: ContainerDep) -> list[ProgressEventDTO]:
    await c.get_project.execute(project_id)  # 404 si no existe
    return await c.progress.history(project_id)


@router.websocket("/ws/projects/{project_id}")
async def progress_ws(websocket: WebSocket, project_id: str) -> None:
    container: Container = websocket.app.state.container
    await websocket.accept()
    try:
        async for event in container.progress.subscribe(project_id):
            await websocket.send_text(event.model_dump_json())
        await websocket.close()
    except WebSocketDisconnect:
        log.debug("Cliente desconectado del progreso de %s", project_id)


def _error(status_code: int, exc: Exception) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=status_code)


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = container or await build_container(settings)
        try:
            yield
        finally:
            await app.state.container.aclose()

    app = FastAPI(
        title="Plano 3D API",
        version="0.1.0",
        description="Convierte la foto de un plano en un modelo 3D navegable.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    handlers: list[tuple[type[Exception], int]] = [
        (ProjectNotFoundError, 404),
        (UnsupportedFileError, 415),
        (FileTooLargeError, 413),
        (InvalidStateTransitionError, 409),
        (ConcurrencyError, 409),
        (EntityNotFoundError, 404),
        (NoDetectorAvailableError, 422),
        (DomainError, 422),
    ]
    for exc_type, code in handlers:
        app.add_exception_handler(exc_type, lambda _r, e, code=code: _error(code, e))
    return app
