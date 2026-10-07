"""Lectores de texto: Claude (con cliente falso) y consenso."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from plano3d.application.ports import ReadText, TextReader
from plano3d.infrastructure.ocr.budget import ClaudeBudget, ResponseCache
from plano3d.infrastructure.ocr.claude import ClaudeTextReader
from plano3d.infrastructure.ocr.consensus import ConsensusReader


class _FakeMessages:
    def __init__(self, payload: dict[str, Any], stop: str = "end_turn") -> None:
        self.payload = payload
        self.stop = stop
        self.calls: list[dict[str, Any]] = []

    def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        block = SimpleNamespace(type="text", text=json.dumps(self.payload))
        usage = SimpleNamespace(input_tokens=1000, output_tokens=100)
        return SimpleNamespace(stop_reason=self.stop, content=[block], usage=usage)


def _client(payload: dict[str, Any], stop: str = "end_turn") -> Any:
    msgs = _FakeMessages(payload, stop)
    return SimpleNamespace(messages=msgs), msgs


@pytest.fixture
def reader(tmp_path: Any) -> Any:
    """Fábrica de lectores con tope y caché aislados (nunca el gasto real)."""

    def make(client: Any, limit: float = 1.0) -> ClaudeTextReader:
        budget = ClaudeBudget(tmp_path / "uso.json", limit)
        return ClaudeTextReader(client, budget=budget, cache=ResponseCache(tmp_path / "cache"))

    return make


def crops(n: int) -> list[np.ndarray]:
    return [np.full((40, 80, 3), 255, np.uint8) for _ in range(n)]


def test_claude_lee_un_lote_con_salida_estructurada(reader: Any) -> None:
    payload = {
        "readings": [
            {"index": 0, "text": "3^45", "confidence": 0.95},
            {"index": 1, "text": "14,00", "confidence": 0.99},
        ]
    }
    client, msgs = _client(payload)
    out = reader(client).read(crops(2))
    assert out == [ReadText("3^45", 0.95), ReadText("14,00", 0.99)]
    call = msgs.calls[0]
    assert call["model"] == "claude-haiku-4-5"
    assert call["output_config"]["format"]["type"] == "json_schema"
    images = [c for c in call["messages"][0]["content"] if c["type"] == "image"]
    assert len(images) == 2 and images[0]["source"]["media_type"] == "image/png"


def test_claude_rechazo_o_basura_no_rompe(reader: Any) -> None:
    client, _ = _client({"readings": []}, stop="refusal")
    assert reader(client).read(crops(2)) == [ReadText("", 0.0)] * 2
    bad = SimpleNamespace(
        messages=SimpleNamespace(
            create=lambda **kw: SimpleNamespace(
                stop_reason="end_turn", content=[SimpleNamespace(type="text", text="no")]
            )
        )
    )
    assert reader(bad).read(crops(1)) == [ReadText("", 0.0)]


def test_claude_parte_en_lotes(reader: Any) -> None:
    client, msgs = _client({"readings": []})
    reader(client).read([np.full((40, 80 + k, 3), 255, np.uint8) for k in range(50)])
    assert len(msgs.calls) == 3  # lotes de 24


def test_claude_cachea_y_respeta_el_tope(tmp_path: Any) -> None:
    client, msgs = _client({"readings": [{"index": 0, "text": "2,50", "confidence": 0.9}]})
    budget = ClaudeBudget(tmp_path / "uso.json", limit_usd=0.0016)
    cache = ResponseCache(tmp_path / "cache")
    r = ClaudeTextReader(client, budget=budget, cache=cache)
    assert r.read(crops(1))[0].text == "2,50"
    assert r.read(crops(1))[0].text == "2,50"  # misma imagen: de la caché, sin pagar
    assert len(msgs.calls) == 1
    assert budget.spent == pytest.approx(0.0015)  # 1000 de entrada y 100 de salida en Haiku
    other = [np.full((40, 90, 3), 0, np.uint8)]
    assert r.read(other) == [ReadText("", 0.0)]  # tope agotado: no llama
    assert len(msgs.calls) == 1


class _Fixed(TextReader):
    name = "fijo"

    def __init__(self, texts: list[str]) -> None:
        self.texts = texts

    def read(self, crops):  # type: ignore[no-untyped-def]
        return [ReadText(t, 0.7) for t in self.texts]


def test_consenso() -> None:
    reader = ConsensusReader(_Fixed(["3,45", "3", "", "x"]), _Fixed(["345", "3^50", "4,50", "y"]))
    out = reader.read(crops(4))
    assert out[0].confidence >= 0.98  # mismo valor escrito distinto
    assert out[1].text == "3^50" and out[1].confidence < 0.5  # discrepan: gana Claude, dudosa
    assert out[2].text == "4,50"  # solo uno leyó
    assert out[3] == ReadText("", 0.0)
