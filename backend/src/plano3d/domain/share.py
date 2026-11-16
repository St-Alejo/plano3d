"""Proyecto compartido con otra app por un código (ADR-024).

El dueño de un proyecto pide un código corto («Continuar en Interiores 3D») y lo pega en la
otra app. Esa app lo canjea por un **token de enlace** que solo abre ese proyecto, y con él
se conecta a la sala en vivo con el rol ``interiores``: puede amueblar y cambiar acabados,
pero no la arquitectura (muros, aberturas, ambientes, niveles), que sigue siendo de Plano 3D.

El código vale hasta que el dueño lo revoca; revocarlo deja sin valor el token de enlace
al instante, porque cada uso del token vuelve a mirar el código.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Final, Literal

from plano3d.domain.errors import DomainError

#: sin 0/O ni 1/I: el código se dicta o se copia a mano
SHARE_ALPHABET: Final = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
SHARE_LENGTH: Final = 8
#: cuántos códigos activos puede tener un proyecto a la vez
MAX_ACTIVE_SHARES: Final = 5

ShareApp = Literal["interiores"]
SHARE_APPS: Final[tuple[str, ...]] = ("interiores",)


class InvalidShareError(DomainError):
    """Código con formato inválido o app desconocida."""


def new_share_code() -> str:
    return "".join(secrets.choice(SHARE_ALPHABET) for _ in range(SHARE_LENGTH))


def normalize_share_code(raw: str) -> str:
    """Admite el código como se pega: con espacios, guiones o en minúsculas."""
    code = "".join(ch for ch in raw.upper() if ch.isalnum())
    if len(code) != SHARE_LENGTH or any(ch not in SHARE_ALPHABET for ch in code):
        raise InvalidShareError("El código tiene 8 letras y números (por ejemplo K7QM-3XTP)")
    return code


def format_share_code(code: str) -> str:
    """K7QM3XTP → K7QM-3XTP (más fácil de leer y dictar)."""
    return f"{code[:4]}-{code[4:]}"


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class ProjectShare:
    code: str
    project_id: str
    #: cuenta dueña del proyecto cuando se creó el código (None = servidor sin cuentas)
    owner_id: str | None
    app: ShareApp = "interiores"
    created_at: datetime = field(default_factory=_now)
    revoked_at: datetime | None = None
    #: última vez que la otra app lo canjeó (para la lista «Conexiones activas»)
    claimed_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.app not in SHARE_APPS:
            raise InvalidShareError(f"App desconocida: {self.app}")
        normalize_share_code(self.code)

    @classmethod
    def create(
        cls, project_id: str, owner_id: str | None, app: ShareApp = "interiores"
    ) -> ProjectShare:
        return cls(code=new_share_code(), project_id=project_id, owner_id=owner_id, app=app)

    @property
    def active(self) -> bool:
        return self.revoked_at is None

    def revoked(self) -> ProjectShare:
        return self if self.revoked_at else replace(self, revoked_at=_now())

    def claimed(self) -> ProjectShare:
        return replace(self, claimed_at=_now())
