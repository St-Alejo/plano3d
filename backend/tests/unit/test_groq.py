"""Groq (con HTTP falso, sin red): asistente, lector de cotas y elección de proveedor."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import httpx
import numpy as np
import pytest

from plano3d import config
from plano3d.application.use_cases.errors import AssistantUnavailableError
from plano3d.infrastructure.groq.assistant import GroqPlanAssistant
from plano3d.infrastructure.groq.client import GroqClient, GroqError
from plano3d.infrastructure.groq.reader import BATCH, ROW_H, GroqTextReader, contact_sheet
from plano3d.infrastructure.ocr.budget import ResponseCache


class _FakeHttp:
    """Responde con ``payloads`` en orden y guarda cada cuerpo enviado."""

    def __init__(self, *payloads: Any, status: int = 200, error: str = "x") -> None:
        self.payloads = list(payloads)
        self.statuses = [status] if isinstance(status, int) else list(status)
        self.error = error
        self.bodies: list[dict[str, Any]] = []

    def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> Any:
        self.bodies.append(json)
        payload = self.payloads.pop(0) if self.payloads else {}
        content = payload if isinstance(payload, str) else _dumps(payload)
        data = {"choices": [{"message": {"content": content}}], "error": {"message": self.error}}
        status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        return SimpleNamespace(status_code=status, json=lambda: data)


def _dumps(v: Any) -> str:
    return json.dumps(v)


def _assistant(tmp_path: Any, http: _FakeHttp) -> GroqPlanAssistant:
    return GroqPlanAssistant(GroqClient(http, "k"), cache=ResponseCache(tmp_path / "c"))


def test_asistente_convierte_las_operaciones(tmp_path: Any) -> None:
    row = {k: None for k in ("name", "width", "depth", "room", "side", "kind")}
    payload = {
        "ops": [{**row, "op": "add_opening", "kind": "door", "room": "Sala", "side": "norte"}],
        "reply": "Listo.",
    }
    http = _FakeHttp(payload)
    out = asyncio.run(_assistant(tmp_path, http).interpret("puerta al norte", "Sala 4x3"))
    assert out.reply == "Listo."
    assert out.ops == [{"op": "add_opening", "kind": "door", "room": "Sala", "side": "norte"}]
    body = http.bodies[0]
    assert body["response_format"]["type"] == "json_schema"
    assert body["messages"][0]["role"] == "system"


def test_asistente_vista_y_cache(tmp_path: Any) -> None:
    payload = {
        "actions": [{"a": "camera", "value": "walk", "number": None, "on": None}],
        "reply": "Ok",
    }
    http = _FakeHttp(payload)
    a = _assistant(tmp_path, http)
    for _ in range(2):
        out = asyncio.run(a.interpret("caminar", "", scope="viewer"))
        assert out.ops == [{"a": "camera", "mode": "walk"}]
    assert len(http.bodies) == 1  # la segunda vez sale de la caché


def test_asistente_error_http_es_no_disponible(tmp_path: Any) -> None:
    with pytest.raises(AssistantUnavailableError):
        asyncio.run(_assistant(tmp_path, _FakeHttp(status=429)).interpret("hola", ""))


def test_cliente_json_invalido_y_red_caida() -> None:
    with pytest.raises(GroqError):
        GroqClient(_FakeHttp("no es json"), "k").chat_json("m", [])

    class _Down:
        def post(self, *a: Any, **k: Any) -> Any:
            raise httpx.ConnectError("sin red")

    with pytest.raises(GroqError):
        GroqClient(_Down(), "k").chat_json("m", [])


def test_lector_lee_por_lotes_con_imagenes(tmp_path: Any) -> None:
    n = BATCH + 2
    first = {"readings": [{"index": i, "text": f"3,{i}", "confidence": 0.9} for i in range(BATCH)]}
    second = {"readings": [{"index": 1, "text": "2,50", "confidence": 2}]}
    http = _FakeHttp(first, second)
    reader = GroqTextReader(GroqClient(http, "k"), cache=ResponseCache(tmp_path / "c"))
    crops = [np.full((40, 80, 3), 255 - i, np.uint8) for i in range(n)]
    out = reader.read(crops)
    assert [r.text for r in out[:2]] == ["3,0", "3,1"]
    assert out[BATCH].text == "" and out[BATCH + 1].text == "2,50"
    assert out[BATCH + 1].confidence == 1.0  # se recorta a [0, 1]
    assert len(http.bodies) == 2  # una llamada por hoja de recortes
    images = [c for c in http.bodies[0]["messages"][0]["content"] if c["type"] == "image_url"]
    assert len(images) == 1 and images[0]["image_url"]["url"].startswith("data:image/png")


def test_hoja_de_recortes_una_fila_por_recorte() -> None:
    crops = [np.zeros((30, 600), np.uint8), np.zeros((90, 40, 3), np.uint8)]
    sheet = contact_sheet(crops)
    assert sheet.shape == (ROW_H * 2, sheet.shape[1], 3)


@pytest.mark.parametrize(("wait", "calls"), [("12.4s", 2), ("1m2.5s", 1)])
def test_reintento_solo_si_la_espera_es_corta(wait: str, calls: int) -> None:
    waits: list[float] = []
    http = _FakeHttp({"ok": 1}, {"ok": 2}, status=[429, 200], error=f"try again in {wait}.")
    client = GroqClient(http, "k", sleep=waits.append)
    if calls == 2:
        assert client.chat_json("m", []) == {"ok": 2} and waits == [12.9]
    else:
        with pytest.raises(GroqError):
            client.chat_json("m", [])
        assert waits == []
    assert len(http.bodies) == calls


def test_lector_si_falla_devuelve_vacio(tmp_path: Any) -> None:
    reader = GroqTextReader(GroqClient(_FakeHttp(status=500), "k"), cache=ResponseCache(tmp_path))
    assert [r.text for r in reader.read([np.zeros((10, 10, 3), np.uint8)])] == [""]


@pytest.mark.parametrize(
    ("ai", "claude", "groq", "expected"),
    [
        ("", True, True, "claude"),
        ("", False, True, "groq"),
        ("groq", True, True, "groq"),
        ("groq", True, False, None),
        ("none", True, True, None),
        ("", False, False, None),
    ],
)
def test_eleccion_de_proveedor(
    monkeypatch: pytest.MonkeyPatch, ai: str, claude: bool, groq: bool, expected: str | None
) -> None:
    monkeypatch.setattr(config, "load_local_env", lambda path=None: None)
    monkeypatch.setenv("PLANO3D_AI", ai)
    monkeypatch.setattr("plano3d.infrastructure.ocr.claude.claude_available", lambda: claude)
    monkeypatch.setattr("plano3d.infrastructure.groq.client.groq_available", lambda: groq)
    assert config.ai_provider() == expected
