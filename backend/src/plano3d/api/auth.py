"""Rutas de cuentas y sesiones (ADR-020): /api/auth/..."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from plano3d.api.deps import ContainerDep, RateLimiter, SignedInUser
from plano3d.application.dto import (
    AuthConfigDTO,
    LinkCodeDTO,
    LinkExchangeDTO,
    LoginDTO,
    RefreshDTO,
    RegisterDTO,
    SessionDTO,
    UserDTO,
    WsTicketDTO,
    user_to_dto,
)
from plano3d.application.use_cases.auth import Session
from plano3d.infrastructure.demo import reset_demo

router = APIRouter(prefix="/api/auth", tags=["cuentas"])

#: intentos por minuto y por IP en las rutas que reciben contraseñas o códigos
_limit = RateLimiter(limit=10, window_s=60)
#: el refresco llega en cada carga de página y en cada pestaña; su token va firmado y no
#: se adivina, así que el límite solo frena abusos (10 por minuto sacaba de la sesión a
#: quien recargaba o abría varias pestañas)
_refresh_limit = RateLimiter(limit=120, window_s=60)


def _session(s: Session) -> SessionDTO:
    return SessionDTO(
        access_token=s.access_token,
        refresh_token=s.refresh_token,
        expires_in=s.expires_in,
        user=user_to_dto(s.user),
    )


@router.get("/config", response_model=AuthConfigDTO)
async def auth_config(c: ContainerDep) -> AuthConfigDTO:
    return AuthConfigDTO(auth_required=c.auth_required, demo_enabled=c.demo_enabled)


@router.post(
    "/register",
    response_model=SessionDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_limit)],
    responses={409: {"description": "Ya hay una cuenta con ese correo"}},
)
async def register(body: RegisterDTO, c: ContainerDep) -> SessionDTO:
    return _session(await c.register.execute(body.email, body.name, body.password))


@router.post(
    "/login",
    response_model=SessionDTO,
    dependencies=[Depends(_limit)],
    responses={401: {"description": "Correo o contraseña incorrectos"}},
)
async def login(body: LoginDTO, c: ContainerDep) -> SessionDTO:
    return _session(await c.login.execute(body.email, body.password))


@router.post(
    "/demo",
    response_model=SessionDTO,
    dependencies=[Depends(_limit)],
    responses={404: {"description": "La demo no está habilitada"}},
)
async def demo(c: ContainerDep) -> SessionDTO:
    """Entra a la cuenta demo (con la casa de 3 pisos) sin escribir contraseña."""
    return _session(await c.demo_login.execute())


@router.post("/demo/reset", status_code=status.HTTP_204_NO_CONTENT)
async def demo_reset(user: SignedInUser, c: ContainerDep) -> Response:
    """Deja la casa demo como nueva (solo desde la cuenta demo)."""
    if not user.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo la cuenta demo se restaura")
    await reset_demo(c)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/refresh", response_model=SessionDTO, dependencies=[Depends(_refresh_limit)])
async def refresh(body: RefreshDTO, c: ContainerDep) -> SessionDTO:
    return _session(await c.refresh_session.execute(body.refresh_token))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: SignedInUser, c: ContainerDep) -> Response:
    """Cierra la sesión en todos los dispositivos (web y escritorio)."""
    await c.logout.execute(user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserDTO)
async def me(user: SignedInUser) -> UserDTO:
    return user_to_dto(user)


@router.post("/link-codes", response_model=LinkCodeDTO, status_code=status.HTTP_201_CREATED)
async def create_link_code(user: SignedInUser, c: ContainerDep) -> LinkCodeDTO:
    """Código de un solo uso (2 min) para abrir esta sesión en la app de escritorio."""
    code, ttl = await c.create_link_code.execute(user)
    return LinkCodeDTO(code=code, expires_in=ttl)


@router.post("/link-codes/exchange", response_model=SessionDTO, dependencies=[Depends(_limit)])
async def exchange_link_code(body: LinkExchangeDTO, c: ContainerDep) -> SessionDTO:
    return _session(await c.exchange_link_code.execute(body.code))


@router.post("/ws-ticket", response_model=WsTicketDTO)
async def ws_ticket(user: SignedInUser, c: ContainerDep) -> WsTicketDTO:
    """Ticket de 60 s para abrir un WebSocket (el navegador no le pone cabeceras)."""
    ticket, ttl = c.create_ws_ticket.execute(user)
    return WsTicketDTO(ticket=ticket, expires_in=ttl)
