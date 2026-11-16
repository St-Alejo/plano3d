"""Casos de uso de cuentas y sesiones (ADR-020).

Sesión = token de acceso corto (va en cada pedido) + token de refresco largo (renueva el
de acceso sin volver a escribir la contraseña). Los dos llevan la ``token_version`` de la
cuenta: cerrar sesión la sube y deja sin valor todos los tokens emitidos antes, en la web
y en el escritorio.

El escritorio se vincula con un **código de un solo uso** que pide la web ya logueada
(«Abrir en escritorio»): así la contraseña no viaja en el enlace ``plano3d://``.
El WebSocket del navegador no puede mandar cabeceras: recibe un **ticket** corto.
"""

from __future__ import annotations

from dataclasses import dataclass

from plano3d.application.ports import (
    LinkCodeStore,
    PasswordHasher,
    TokenKind,
    TokenService,
    UserRepository,
)
from plano3d.application.use_cases.errors import (
    DemoUnavailableError,
    InvalidCredentialsError,
    InvalidTokenError,
    WeakPasswordError,
)
from plano3d.domain.user import User, normalize_email

MIN_PASSWORD = 8
MAX_PASSWORD = 128
LINK_CODE_TTL = 120  # segundos
DEMO_EMAIL = "demo@plano3d.app"
DEMO_NAME = "Cuenta demo"


@dataclass(frozen=True)
class Session:
    user: User
    access_token: str
    refresh_token: str
    expires_in: int


class _Sessions:
    """Emite y valida sesiones; base de los casos de uso que entregan una."""

    def __init__(self, users: UserRepository, tokens: TokenService) -> None:
        self._users = users
        self._tokens = tokens

    def _session(self, user: User) -> Session:
        access, ttl = self._tokens.issue(user, "access")
        refresh, _ = self._tokens.issue(user, "refresh")
        return Session(user, access, refresh, ttl)

    async def _user_from(self, token: str, kind: TokenKind) -> User:
        claims = self._tokens.verify(token, kind)
        user = await self._users.get(claims.user_id)
        if user is None or user.token_version != claims.version:
            raise InvalidTokenError()
        return user


class Register(_Sessions):
    def __init__(self, users: UserRepository, tokens: TokenService, hasher: PasswordHasher) -> None:
        super().__init__(users, tokens)
        self._hasher = hasher

    async def execute(self, email: str, name: str, password: str) -> Session:
        if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
            raise WeakPasswordError(
                f"La contraseña debe tener entre {MIN_PASSWORD} y {MAX_PASSWORD} caracteres"
            )
        if password.strip().lower() == normalize_email(email):
            raise WeakPasswordError("La contraseña no puede ser tu correo")
        user = User.create(email, name, self._hasher.hash(password))
        await self._users.add(user)  # EmailTakenError si ya existe
        return self._session(user)


class Login(_Sessions):
    def __init__(self, users: UserRepository, tokens: TokenService, hasher: PasswordHasher) -> None:
        super().__init__(users, tokens)
        self._hasher = hasher

    async def execute(self, email: str, password: str) -> Session:
        user = await self._users.get_by_email(normalize_email(email))
        # se verifica aunque el correo no exista, para no revelar por el tiempo qué cuentas hay
        stored = user.password_hash if user else _DUMMY_HASH.get(self._hasher)
        if not self._hasher.verify(stored, password) or user is None:
            raise InvalidCredentialsError()
        return self._session(user)


class _DummyHash:
    """Hash de una contraseña cualquiera, calculado una vez por hasher."""

    def __init__(self) -> None:
        self._cache: dict[int, str] = {}

    def get(self, hasher: PasswordHasher) -> str:
        key = id(hasher)
        if key not in self._cache:
            self._cache[key] = hasher.hash("plano3d-cuenta-inexistente")
        return self._cache[key]


_DUMMY_HASH = _DummyHash()


class RefreshSession(_Sessions):
    async def execute(self, refresh_token: str) -> Session:
        return self._session(await self._user_from(refresh_token, "refresh"))


class Authenticate(_Sessions):
    """Token de acceso (o ticket de WebSocket) → usuario vigente."""

    async def execute(self, token: str, kind: TokenKind = "access") -> User:
        return await self._user_from(token, kind)


class Logout:
    """Cierra la sesión en todos los dispositivos."""

    def __init__(self, users: UserRepository) -> None:
        self._users = users

    async def execute(self, user: User) -> None:
        await self._users.save(user.signed_out_everywhere())


class DemoLogin(_Sessions):
    def __init__(self, users: UserRepository, tokens: TokenService, enabled: bool) -> None:
        super().__init__(users, tokens)
        self._enabled = enabled

    async def execute(self) -> Session:
        user = await self._users.get_by_email(DEMO_EMAIL) if self._enabled else None
        if user is None or not user.is_demo:
            raise DemoUnavailableError()
        return self._session(user)


class CreateLinkCode:
    def __init__(self, codes: LinkCodeStore) -> None:
        self._codes = codes

    async def execute(self, user: User) -> tuple[str, int]:
        return await self._codes.create(user.id, LINK_CODE_TTL), LINK_CODE_TTL


class ExchangeLinkCode(_Sessions):
    def __init__(self, users: UserRepository, tokens: TokenService, codes: LinkCodeStore) -> None:
        super().__init__(users, tokens)
        self._codes = codes

    async def execute(self, code: str) -> Session:
        user_id = await self._codes.consume(code.strip().upper())
        user = await self._users.get(user_id) if user_id else None
        if user is None:
            raise InvalidTokenError("El código venció o ya se usó: pide uno nuevo en la web")
        return self._session(user)


class CreateWsTicket:
    def __init__(self, tokens: TokenService) -> None:
        self._tokens = tokens

    def execute(self, user: User) -> tuple[str, int]:
        return self._tokens.issue(user, "ws")
