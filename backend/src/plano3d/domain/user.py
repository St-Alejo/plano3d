"""Cuenta de usuario (ADR-020): dueña de sus proyectos en la web y en el escritorio."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime

from plano3d.domain.building import new_id
from plano3d.domain.errors import DomainError

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_NAME = 80


class InvalidUserError(DomainError):
    """Correo o nombre inválidos."""


def normalize_email(email: str) -> str:
    return email.strip().lower()


@dataclass(frozen=True, slots=True)
class User:
    id: str
    email: str
    name: str
    #: hash argon2 de la contraseña (nunca la contraseña)
    password_hash: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    #: sube al cerrar sesión en todos los dispositivos: invalida los tokens anteriores
    token_version: int = 0
    #: la cuenta de demostración (se entra sin contraseña y se puede restaurar)
    is_demo: bool = False

    def __post_init__(self) -> None:
        if not EMAIL_RE.match(self.email) or self.email != normalize_email(self.email):
            raise InvalidUserError("Correo inválido")
        if not self.name.strip() or len(self.name) > MAX_NAME:
            raise InvalidUserError(f"El nombre debe tener entre 1 y {MAX_NAME} caracteres")

    @classmethod
    def create(
        cls,
        email: str,
        name: str,
        password_hash: str,
        *,
        user_id: str | None = None,
        is_demo: bool = False,
    ) -> User:
        return cls(
            id=user_id or new_id("usr"),
            email=normalize_email(email),
            name=name.strip()[:MAX_NAME],
            password_hash=password_hash,
            is_demo=is_demo,
        )

    def signed_out_everywhere(self) -> User:
        return replace(self, token_version=self.token_version + 1)
