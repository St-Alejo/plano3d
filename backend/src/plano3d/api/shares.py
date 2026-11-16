"""Compartir un proyecto con Interiores 3D por un código (ADR-024).

Dueño (con su sesión):
    POST   /api/projects/{id}/shares          crea un código
    GET    /api/projects/{id}/shares          códigos activos («Conexiones activas»)
    DELETE /api/projects/{id}/shares/{code}   lo revoca: la otra app pierde el acceso ya

Otra app (sin cuenta de Plano 3D):
    POST   /api/shares/claim {code}           canjea el código por un token de enlace
    GET    /api/shares/project                el proyecto, con ``Authorization: Bearer <token>``
    WS     /api/ws/collab/{id}?link=<token>   la sala en vivo con el rol ``interiores``
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from plano3d.api.deps import ContainerDep, RateLimiter, require_project_access
from plano3d.application.dto import (
    LinkGrantDTO,
    ProjectDTO,
    ShareClaimDTO,
    ShareCreateDTO,
    ShareDTO,
    project_to_dto,
)
from plano3d.application.use_cases.errors import InvalidTokenError
from plano3d.domain.share import ProjectShare, format_share_code

owned = APIRouter(
    prefix="/api/projects/{project_id}/shares",
    tags=["compartir"],
    dependencies=[Depends(require_project_access)],
)
public = APIRouter(prefix="/api/shares", tags=["compartir"])

#: canjes por minuto y por IP: los códigos son cortos, no se deben poder adivinar a fuerza
_claim_limit = RateLimiter(limit=10, window_s=60)
_bearer = HTTPBearer(auto_error=False, description="Token de enlace de /api/shares/claim")


def share_to_dto(share: ProjectShare) -> ShareDTO:
    return ShareDTO(
        code=format_share_code(share.code),
        app=share.app,
        created_at=share.created_at,
        claimed_at=share.claimed_at,
    )


@owned.post("", response_model=ShareDTO, status_code=status.HTTP_201_CREATED)
async def create_share(
    project_id: str, c: ContainerDep, body: ShareCreateDTO | None = None
) -> ShareDTO:
    app = body.app if body else "interiores"
    return share_to_dto(await c.create_share.execute(project_id, app))


@owned.get("", response_model=list[ShareDTO])
async def list_shares(project_id: str, c: ContainerDep) -> list[ShareDTO]:
    return [share_to_dto(s) for s in await c.list_shares.execute(project_id)]


@owned.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(project_id: str, code: str, c: ContainerDep) -> Response:
    await c.revoke_share.execute(project_id, code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@public.post(
    "/claim",
    response_model=LinkGrantDTO,
    dependencies=[Depends(_claim_limit)],
    responses={404: {"description": "El código no existe o fue revocado"}},
)
async def claim_share(body: ShareClaimDTO, c: ContainerDep) -> LinkGrantDTO:
    grant = await c.claim_share.execute(body.code)
    return LinkGrantDTO(
        token=grant.token,
        expires_in=grant.expires_in,
        project_id=grant.project.id,
        project_name=grant.project.name,
        role=grant.share.app,
    )


@public.get("/project", response_model=ProjectDTO)
async def shared_project(
    c: ContainerDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> ProjectDTO:
    if credentials is None:
        raise InvalidTokenError("Falta el token de enlace")
    _, project = await c.resolve_link.execute(credentials.credentials)
    # con la sala abierta, primero se guarda lo pendiente: la otra app parte de lo último
    await c.collab.flush(project.id)
    return project_to_dto(await c.get_project.execute(project.id))
