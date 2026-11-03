"""Groq de verdad: frases de fachada → cambios válidos. Solo con ``-m groq`` y la clave.

``pytest -m groq tests/integration/test_groq_real.py`` (lee GROQ_API_KEY de backend/.env).
Gasta cuota real, por eso no corre con el resto de la suite.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest

from plano3d.config import load_local_env
from plano3d.infrastructure.groq.assistant import GroqPlanAssistant
from plano3d.infrastructure.groq.client import groq_available
from plano3d.infrastructure.ocr.budget import ResponseCache

pytestmark = pytest.mark.groq

CONTEXT = "Modo del plano: presentacion. Fachada: moderna_blanca. Pisos: 3."

PHRASES: list[tuple[str, dict[str, Any]]] = [
    ("pon madera en el segundo piso", {"part": "upper", "material": "madera"}),
    ("marcos de las ventanas negros", {"paint": "frame"}),
    ("quita la jardinera", {"feature": "jardinera", "on": False}),
    ("hazla más moderna, estilo contemporáneo", {"style": "moderna_contemporanea"}),
    ("el primer piso en ladrillo", {"part": "ground", "material": "ladrillo"}),
]


@pytest.fixture(scope="module")
def assistant(tmp_path_factory: pytest.TempPathFactory) -> Iterator[GroqPlanAssistant]:
    # tests/conftest.py apaga Groq para toda la suite; aquí se prende solo para este módulo
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("PLANO3D_GROQ", "1")
        load_local_env()
        if not groq_available():
            pytest.skip("sin GROQ_API_KEY")
        yield GroqPlanAssistant(cache=ResponseCache(tmp_path_factory.mktemp("groq")))


@pytest.mark.parametrize(("phrase", "expected"), PHRASES)
def test_groq_entiende_la_fachada(
    assistant: GroqPlanAssistant, phrase: str, expected: dict[str, Any]
) -> None:
    out = asyncio.run(assistant.interpret(phrase, CONTEXT, scope="viewer"))
    edits = [op["edit"] for op in out.ops if op.get("a") == "facade"]
    assert edits, f"sin cambios de fachada para {phrase!r}: {out}"
    assert any(all(e.get(k) == v for k, v in expected.items()) for e in edits), edits
