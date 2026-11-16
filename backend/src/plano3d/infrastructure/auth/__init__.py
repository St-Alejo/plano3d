"""Adaptadores de cuentas (ADR-020): hash argon2, tokens JWT y códigos de vinculación."""

from __future__ import annotations

import asyncio
import secrets
import time
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher as _Argon2
from argon2.exceptions import InvalidHashError, VerificationError

from plano3d.application.ports import (
    LinkCodeStore,
    PasswordHasher,
    TokenClaims,
    TokenKind,
    TokenService,
)
from plano3d.application.use_cases.errors import InvalidTokenError
from plano3d.domain.user import User

#: sin 0/O ni 1/I: el código se lee en voz alta o se copia a mano
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6


class Argon2PasswordHasher(PasswordHasher):
    def __init__(self) -> None:
        self._h = _Argon2()

    def hash(self, password: str) -> str:
        return self._h.hash(password)

    def verify(self, password_hash: str, password: str) -> bool:
        try:
            return self._h.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False


class JwtTokenService(TokenService):
    """HS256 con un secreto del servidor (``PLANO3D_JWT_SECRET``)."""

    ISSUER = "plano3d"

    def __init__(
        self,
        secret: str,
        access_ttl: timedelta = timedelta(hours=1),
        refresh_ttl: timedelta = timedelta(days=30),
        ws_ttl: timedelta = timedelta(seconds=60),
    ) -> None:
        if len(secret) < 32:
            raise ValueError("El secreto de los tokens debe tener al menos 32 caracteres")
        self._secret = secret
        self._ttl: dict[TokenKind, timedelta] = {
            "access": access_ttl,
            "refresh": refresh_ttl,
            "ws": ws_ttl,
        }

    def issue(self, user: User, kind: TokenKind) -> tuple[str, int]:
        now = datetime.now(UTC)
        ttl = self._ttl[kind]
        claims = {
            "sub": user.id,
            "typ": kind,
            "ver": user.token_version,
            "iss": self.ISSUER,
            "iat": now,
            "exp": now + ttl,
            "jti": secrets.token_urlsafe(8),
        }
        return jwt.encode(claims, self._secret, algorithm="HS256"), int(ttl.total_seconds())

    def verify(self, token: str, kind: TokenKind) -> TokenClaims:
        try:
            data = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                issuer=self.ISSUER,
                options={"require": ["sub", "typ", "ver", "exp"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise InvalidTokenError("La sesión venció: vuelve a entrar") from exc
        except jwt.PyJWTError as exc:
            raise InvalidTokenError() from exc
        if data.get("typ") != kind:
            raise InvalidTokenError("Token de otro tipo")
        return TokenClaims(str(data["sub"]), kind, int(data["ver"]))


class InMemoryLinkCodeStore(LinkCodeStore):
    """Los códigos viven 2 minutos: no hace falta guardarlos fuera del proceso."""

    def __init__(self) -> None:
        self._codes: dict[str, tuple[str, float]] = {}
        self._lock = asyncio.Lock()

    async def create(self, user_id: str, ttl_seconds: int) -> str:
        async with self._lock:
            now = time.monotonic()
            self._codes = {c: v for c, v in self._codes.items() if v[1] > now}
            while True:
                code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
                if code not in self._codes:
                    break
            self._codes[code] = (user_id, now + ttl_seconds)
            return code

    async def consume(self, code: str) -> str | None:
        async with self._lock:
            entry = self._codes.pop(code, None)
            if entry is None or entry[1] <= time.monotonic():
                return None
            return entry[0]
