"""El hash de contraseñas (lento a propósito) no debe congelar el servidor.

argon2 tarda decenas o cientos de ms; si corre en el bucle de eventos, cada entrada o
registro detiene la API entera y las salas de edición en vivo.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from plano3d.application.ports import PasswordHasher
from plano3d.application.use_cases.auth import Login, Register
from plano3d.application.use_cases.errors import InvalidCredentialsError
from plano3d.infrastructure.auth import JwtTokenService
from plano3d.infrastructure.memory import InMemoryUserRepository

SLOW = 0.3


class SlowHasher(PasswordHasher):
    def hash(self, password: str) -> str:
        time.sleep(SLOW)
        return f"h:{password}"

    def verify(self, password_hash: str, password: str) -> bool:
        time.sleep(SLOW)
        return password_hash == f"h:{password}"


async def _ticks_while(coro: object) -> int:
    """Cuántas veces avanza otra tarea (cada 20 ms) mientras corre ``coro``."""
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    t = asyncio.create_task(ticker())
    try:
        await coro  # type: ignore[misc]
    finally:
        t.cancel()
    return ticks


@pytest.fixture
def parts() -> tuple[InMemoryUserRepository, JwtTokenService, SlowHasher]:
    return InMemoryUserRepository(), JwtTokenService("x" * 40), SlowHasher()


async def test_registrarse_no_detiene_otras_tareas(
    parts: tuple[InMemoryUserRepository, JwtTokenService, SlowHasher],
) -> None:
    ticks = await _ticks_while(Register(*parts).execute("a@b.co", "Ana", "clave-segura-1"))
    assert ticks >= 5  # ~15 en 0,3 s; 0 si el hash bloqueara el bucle


async def test_entrar_no_detiene_otras_tareas(
    parts: tuple[InMemoryUserRepository, JwtTokenService, SlowHasher],
) -> None:
    await Register(*parts).execute("a@b.co", "Ana", "clave-segura-1")
    ticks = await _ticks_while(Login(*parts).execute("a@b.co", "clave-segura-1"))
    assert ticks >= 5


async def test_entrar_con_clave_mala_sigue_fallando(
    parts: tuple[InMemoryUserRepository, JwtTokenService, SlowHasher],
) -> None:
    await Register(*parts).execute("a@b.co", "Ana", "clave-segura-1")
    with pytest.raises(InvalidCredentialsError):
        await Login(*parts).execute("a@b.co", "otra-clave-22")
    with pytest.raises(InvalidCredentialsError):
        await Login(*parts).execute("nadie@b.co", "otra-clave-22")
