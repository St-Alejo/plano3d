"""Compartir un proyecto con otra app por un código (ADR-024).

* ``CreateShareCode``: el dueño pide un código (máximo cinco activos por proyecto).
* ``ListShares`` / ``RevokeShare``: la lista «Conexiones activas» y su botón «Revocar».
* ``ClaimShare``: la otra app canjea el código por un **token de enlace**.
* ``ResolveLink``: cada uso del token (REST o la sala en vivo) vuelve a mirar el código,
  así revocarlo corta el acceso al instante aunque el token no haya vencido.
"""

from __future__ import annotations

from dataclasses import dataclass

from plano3d.application.ports import ProjectRepository, ShareRepository, TokenService
from plano3d.application.use_cases.errors import (
    InvalidTokenError,
    ProjectNotFoundError,
    ShareNotFoundError,
    TooManySharesError,
)
from plano3d.domain import Project
from plano3d.domain.share import (
    MAX_ACTIVE_SHARES,
    ProjectShare,
    ShareApp,
    normalize_share_code,
)


@dataclass(frozen=True)
class LinkGrant:
    """Lo que recibe la otra app al canjear el código."""

    token: str
    expires_in: int
    share: ProjectShare
    project: Project


class CreateShareCode:
    def __init__(self, repo: ProjectRepository, shares: ShareRepository) -> None:
        self._repo = repo
        self._shares = shares

    async def execute(self, project_id: str, app: ShareApp = "interiores") -> ProjectShare:
        project = await self._repo.get(project_id)
        if project is None:
            raise ProjectNotFoundError(project_id)
        active = [s for s in await self._shares.list_for_project(project_id) if s.active]
        if len(active) >= MAX_ACTIVE_SHARES:
            raise TooManySharesError(
                f"Este proyecto ya tiene {MAX_ACTIVE_SHARES} códigos activos: revoca uno antes"
            )
        while True:
            share = ProjectShare.create(project_id, project.owner_id, app)
            if await self._shares.get(share.code) is None:
                break
        await self._shares.add(share)
        return share


class ListShares:
    def __init__(self, shares: ShareRepository) -> None:
        self._shares = shares

    async def execute(self, project_id: str) -> list[ProjectShare]:
        items = [s for s in await self._shares.list_for_project(project_id) if s.active]
        return sorted(items, key=lambda s: s.created_at, reverse=True)


class RevokeShare:
    def __init__(self, shares: ShareRepository) -> None:
        self._shares = shares

    async def execute(self, project_id: str, raw_code: str) -> None:
        share = await self._shares.get(normalize_share_code(raw_code))
        if share is None or share.project_id != project_id:
            raise ShareNotFoundError()
        await self._shares.save(share.revoked())


class ResolveLink:
    """Token de enlace → código vigente y su proyecto."""

    def __init__(
        self, repo: ProjectRepository, shares: ShareRepository, tokens: TokenService
    ) -> None:
        self._repo = repo
        self._shares = shares
        self._tokens = tokens

    async def execute(self, token: str) -> tuple[ProjectShare, Project]:
        claims = self._tokens.verify_link(token)
        share = await self._shares.get(claims.code)
        if share is None or not share.active or share.project_id != claims.project_id:
            raise InvalidTokenError("El dueño dejó de compartir este proyecto")
        project = await self._repo.get(share.project_id)
        if project is None:
            raise InvalidTokenError("El proyecto compartido ya no existe")
        return share, project


class ClaimShare:
    def __init__(
        self, repo: ProjectRepository, shares: ShareRepository, tokens: TokenService
    ) -> None:
        self._repo = repo
        self._shares = shares
        self._tokens = tokens

    async def execute(self, raw_code: str) -> LinkGrant:
        share = await self._shares.get(normalize_share_code(raw_code))
        if share is None or not share.active:
            raise ShareNotFoundError()
        project = await self._repo.get(share.project_id)
        if project is None:
            raise ShareNotFoundError()
        share = share.claimed()
        await self._shares.save(share)
        token, ttl = self._tokens.issue_link(share)
        return LinkGrant(token, ttl, share, project)
