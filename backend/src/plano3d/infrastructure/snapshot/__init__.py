"""Copia del estado de la API en memoria (cuentas, proyectos y versiones) en un archivo o Blob.

Patrón Decorator: ``SnapshottingProjectRepository`` y ``SnapshottingUserRepository`` envuelven
a los repositorios en memoria y, tras cada escritura, avisan al ``Snapshotter``, que espera
unos segundos (agrupa ráfagas de cambios, p. ej. la edición en vivo) y sube un
``state.json.gz``. Al arrancar se restaura la última copia. Así la réplica única de la demo
puede escalar a cero sin perder lo que se hizo.
"""

from __future__ import annotations

import asyncio
import builtins
import contextlib
import gzip
import json
import logging
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.application.ports import (
    ProjectRepository,
    ShareRepository,
    StateSnapshotStore,
    UserRepository,
)
from plano3d.domain import BuildingModel, ModelRevision, Project, ProjectStatus
from plano3d.domain.share import ProjectShare
from plano3d.domain.user import User

log = logging.getLogger(__name__)

FORMAT = 1


# ---------------------------------------------------------------- serialización


def _model_out(model: BuildingModel) -> dict[str, Any]:
    data: dict[str, Any] = model_to_dto(model).model_dump(mode="json")
    return data


def _model_in(data: dict[str, Any]) -> BuildingModel:
    return model_from_dto(BuildingModelDTO.model_validate(data))


def _project_out(p: Project) -> dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "original_image_key": p.original_image_key,
        "corners": [list(c) for c in p.corners] if p.corners else None,
        "status": p.status.value,
        "model": _model_out(p.model) if p.model else None,
        "revision": p.revision,
        "error": p.error,
        "owner_id": p.owner_id,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }


def _project_in(d: dict[str, Any]) -> Project:
    return Project(
        id=d["id"],
        name=d["name"],
        original_image_key=d["original_image_key"],
        corners=[(float(x), float(y)) for x, y in d["corners"]] if d.get("corners") else None,
        status=ProjectStatus(d["status"]),
        model=_model_in(d["model"]) if d.get("model") else None,
        revision=d["revision"],
        error=d.get("error"),
        owner_id=d.get("owner_id"),
        created_at=datetime.fromisoformat(d["created_at"]),
        updated_at=datetime.fromisoformat(d["updated_at"]),
    )


def _revision_out(r: ModelRevision) -> dict[str, Any]:
    return {
        "project_id": r.project_id,
        "number": r.number,
        "model": _model_out(r.model),
        "summary": r.summary,
        "created_at": r.created_at.isoformat(),
    }


def _revision_in(d: dict[str, Any]) -> ModelRevision:
    return ModelRevision(
        project_id=d["project_id"],
        number=d["number"],
        model=_model_in(d["model"]),
        summary=d["summary"],
        created_at=datetime.fromisoformat(d["created_at"]),
    )


def _user_out(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "password_hash": u.password_hash,
        "created_at": u.created_at.isoformat(),
        "token_version": u.token_version,
        "is_demo": u.is_demo,
    }


def _user_in(d: dict[str, Any]) -> User:
    return User(
        id=d["id"],
        email=d["email"],
        name=d["name"],
        password_hash=d["password_hash"],
        created_at=datetime.fromisoformat(d["created_at"]),
        token_version=d["token_version"],
        is_demo=d["is_demo"],
    )


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _share_out(s: ProjectShare) -> dict[str, Any]:
    return {
        "code": s.code,
        "project_id": s.project_id,
        "owner_id": s.owner_id,
        "app": s.app,
        "created_at": s.created_at.isoformat(),
        "revoked_at": _dt(s.revoked_at),
        "claimed_at": _dt(s.claimed_at),
    }


def _share_in(d: dict[str, Any]) -> ProjectShare:
    def when(key: str) -> datetime | None:
        return datetime.fromisoformat(d[key]) if d.get(key) else None

    return ProjectShare(
        code=d["code"],
        project_id=d["project_id"],
        owner_id=d.get("owner_id"),
        app=d.get("app", "interiores"),
        created_at=datetime.fromisoformat(d["created_at"]),
        revoked_at=when("revoked_at"),
        claimed_at=when("claimed_at"),
    )


async def encode_state(
    repo: ProjectRepository, users: UserRepository, shares: ShareRepository | None = None
) -> bytes:
    projects = await repo.list()
    revisions = [r for p in projects for r in await repo.list_revisions(p.id)]
    state = {
        "format": FORMAT,
        "users": [_user_out(u) for u in await users.list()],
        "projects": [_project_out(p) for p in projects],
        "revisions": [_revision_out(r) for r in revisions],
        "shares": [_share_out(s) for s in await shares.list()] if shares else [],
    }
    return gzip.compress(json.dumps(state, ensure_ascii=False).encode("utf-8"), mtime=0)


async def decode_state(
    data: bytes,
    repo: ProjectRepository,
    users: UserRepository,
    shares: ShareRepository | None = None,
) -> int:
    """Carga la copia en repositorios vacíos. Devuelve cuántos proyectos restauró."""
    state = json.loads(gzip.decompress(data).decode("utf-8"))
    if state.get("format") != FORMAT:
        raise ValueError(f"Formato de copia desconocido: {state.get('format')}")
    for u in state["users"]:
        await users.add(_user_in(u))
    for p in state["projects"]:
        await repo.add(_project_in(p))
    for r in sorted(state["revisions"], key=lambda r: (r["project_id"], r["number"])):
        await repo.add_revision(_revision_in(r))
    if shares is not None:
        for sh in state.get("shares", []):  # copias anteriores a ADR-024 no traen códigos
            await shares.add(_share_in(sh))
    return len(state["projects"])


# ---------------------------------------------------------------- adaptadores de copia


class FileSnapshotStore(StateSnapshotStore):
    """Copia en un archivo local (desarrollo, o un volumen montado)."""

    def __init__(self, path: Path) -> None:
        self.path = path

    async def load(self) -> bytes | None:
        return await asyncio.to_thread(self._load)

    def _load(self) -> bytes | None:
        return self.path.read_bytes() if self.path.exists() else None

    async def save(self, data: bytes) -> None:
        await asyncio.to_thread(self._save, data)

    def _save(self, data: bytes) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(self.path)  # atómico: nunca queda una copia a medias


# ---------------------------------------------------------------- coordinador y decoradores


class Snapshotter:
    """Sube la copia unos segundos después del último cambio (y al apagar)."""

    def __init__(
        self,
        repo: ProjectRepository,
        users: UserRepository,
        store: StateSnapshotStore,
        delay_s: float = 2.0,
        shares: ShareRepository | None = None,
    ) -> None:
        self.repo = repo
        self.users = users
        self.shares = shares
        self.store = store
        self.delay_s = delay_s
        self._dirty = False
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    async def restore(self) -> int:
        data = await self.store.load()
        if data is None:
            log.info("Sin copia previa del estado: se arranca en limpio")
            return 0
        count = await decode_state(data, self.repo, self.users, self.shares)
        log.info("Estado restaurado desde la copia (%d proyectos)", count)
        return count

    def mark_dirty(self) -> None:
        self._dirty = True
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._later())

    async def _later(self) -> None:
        await asyncio.sleep(self.delay_s)
        try:
            await self.flush()
        except Exception:
            log.exception("No se pudo guardar la copia del estado")

    async def flush(self) -> None:
        async with self._lock:
            if not self._dirty:
                return
            self._dirty = False  # lo que cambie mientras se codifica vuelve a marcarla
            try:
                await self.store.save(await encode_state(self.repo, self.users, self.shares))
            except Exception:
                self._dirty = True
                raise

    async def aclose(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self.flush()


class SnapshottingProjectRepository(ProjectRepository):
    def __init__(self, inner: ProjectRepository, on_change: Callable[[], None]) -> None:
        self.inner = inner
        self._changed = on_change

    async def add(self, project: Project) -> None:
        await self.inner.add(project)
        self._changed()

    async def get(self, project_id: str) -> Project | None:
        return await self.inner.get(project_id)

    async def list(self) -> builtins.list[Project]:
        return await self.inner.list()

    async def save(self, project: Project, expected_revision: int | None = None) -> None:
        await self.inner.save(project, expected_revision)
        self._changed()

    async def delete(self, project_id: str) -> None:
        await self.inner.delete(project_id)
        self._changed()

    async def add_revision(self, revision: ModelRevision) -> None:
        await self.inner.add_revision(revision)
        self._changed()

    async def list_revisions(self, project_id: str) -> builtins.list[ModelRevision]:
        return await self.inner.list_revisions(project_id)

    async def get_revision(self, project_id: str, number: int) -> ModelRevision | None:
        return await self.inner.get_revision(project_id, number)


class SnapshottingUserRepository(UserRepository):
    def __init__(self, inner: UserRepository, on_change: Callable[[], None]) -> None:
        self.inner = inner
        self._changed = on_change

    async def add(self, user: User) -> None:
        await self.inner.add(user)
        self._changed()

    async def get(self, user_id: str) -> User | None:
        return await self.inner.get(user_id)

    async def get_by_email(self, email: str) -> User | None:
        return await self.inner.get_by_email(email)

    async def save(self, user: User) -> None:
        await self.inner.save(user)
        self._changed()

    async def list(self) -> builtins.list[User]:
        return await self.inner.list()


class SnapshottingShareRepository(ShareRepository):
    def __init__(self, inner: ShareRepository, on_change: Callable[[], None]) -> None:
        self.inner = inner
        self._changed = on_change

    async def add(self, share: ProjectShare) -> None:
        await self.inner.add(share)
        self._changed()

    async def get(self, code: str) -> ProjectShare | None:
        return await self.inner.get(code)

    async def list_for_project(self, project_id: str) -> builtins.list[ProjectShare]:
        return await self.inner.list_for_project(project_id)

    async def save(self, share: ProjectShare) -> None:
        await self.inner.save(share)
        self._changed()

    async def list(self) -> builtins.list[ProjectShare]:
        return await self.inner.list()


async def enable_snapshots(
    container: Any, store: StateSnapshotStore, delay_s: float = 2.0
) -> Snapshotter:
    """Restaura la copia y envuelve los repositorios del contenedor para mantenerla al día.

    ``container``: ``plano3d.container.Container`` (en memoria). Al cerrarlo se sube la
    última copia pendiente.
    """
    snap = Snapshotter(container.repo, container.users, store, delay_s, container.shares)
    await snap.restore()
    container.repo = SnapshottingProjectRepository(container.repo, snap.mark_dirty)
    container.users = SnapshottingUserRepository(container.users, snap.mark_dirty)
    container.shares = SnapshottingShareRepository(container.shares, snap.mark_dirty)
    container._closers.insert(0, snap)
    return snap
