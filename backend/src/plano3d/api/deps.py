"""Dependencias comunes de la API: contenedor, usuario de la sesión y acceso a proyectos."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from plano3d.application.use_cases.errors import AuthError, ProjectNotFoundError
from plano3d.container import Container
from plano3d.domain.user import User


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


ContainerDep = Annotated[Container, Depends(get_container)]

_bearer = HTTPBearer(auto_error=False, description="Token de acceso de /api/auth/login")


async def current_user(
    c: ContainerDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User | None:
    """Usuario de la sesión. ``None`` solo si el servidor corre sin login (pruebas)."""
    if not c.auth_required:
        return None
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Inicia sesión para continuar",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await c.authenticate.execute(credentials.credentials)


async def signed_in(user: Annotated[User | None, Depends(current_user)]) -> User:
    """Para rutas que solo tienen sentido con cuenta (perfil, vincular el escritorio)."""
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Este servidor no tiene cuentas")
    return user


CurrentUser = Annotated[User | None, Depends(current_user)]
SignedInUser = Annotated[User, Depends(signed_in)]


def owner_of(user: User | None) -> str | None:
    """Dueño para filtrar y crear proyectos (None = sin login: todos)."""
    return user.id if user else None


async def ensure_access(c: Container, user: User | None, project_id: str) -> None:
    """Un proyecto de otra cuenta se trata como inexistente (404, no 403: no se revela)."""
    if user is None:
        return
    project = await c.repo.get(project_id)
    if project is not None and project.owner_id != user.id:
        raise ProjectNotFoundError(project_id)


async def require_project_access(project_id: str, c: ContainerDep, user: CurrentUser) -> None:
    await ensure_access(c, user, project_id)


class RateLimiter:
    """Ventana deslizante por IP y ruta: frena a quien prueba contraseñas por fuerza bruta."""

    def __init__(self, limit: int = 10, window_s: float = 60.0) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def __call__(self, request: Request) -> None:
        host = request.client.host if request.client else "?"
        # por app: cada instancia (y cada prueba) lleva su propia cuenta
        key = f"{id(request.app)}:{host}:{request.url.path}"
        now = time.monotonic()
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Demasiados intentos: espera un minuto",
                headers={"Retry-After": str(int(self.window_s))},
            )
        hits.append(now)


async def collab_sync(project_id: str, c: ContainerDep) -> AsyncIterator[None]:
    """Edición por REST con gente editando en vivo: antes se guarda lo pendiente de la sala
    (la edición parte de lo último) y después todos reciben el modelo resultante."""
    await c.collab.flush(project_id)
    yield
    await c.collab.reload(project_id)


async def collab_flush(project_id: str, c: ContainerDep) -> None:
    """Lectura por REST con la sala abierta: primero se guarda lo pendiente, así quien lee
    (otra pestaña sin conexión en vivo, una exportación, el historial) ve lo último."""
    await c.collab.flush(project_id)


async def ws_user(websocket: WebSocket, ticket: str | None) -> tuple[bool, User | None]:
    """(permitido, usuario) para un WebSocket: el ticket viene de POST /api/auth/ws-ticket."""
    container: Container = websocket.app.state.container
    if not container.auth_required:
        return True, None
    if not ticket:
        return False, None
    try:
        return True, await container.authenticate.execute(ticket, "ws")
    except AuthError:
        return False, None


#: cierre por falta de sesión (rango 4000-4999 = códigos de la aplicación)
WS_UNAUTHORIZED = 4401
