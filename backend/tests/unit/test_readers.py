"""Lectores de texto: Claude (con cliente falso) y consenso."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import numpy as np

from plano3d.application.ports import ReadText, TextReader
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
        return SimpleNamespace(stop_reason=self.stop, content=[block])


def _client(payload: dict[str, Any], stop: str = "end_turn") -> Any:
    msgs = _FakeMessages(payload, stop)
    return SimpleNamespace(beta=SimpleNamespace(messages=msgs)), msgs


def crops(n: int) -> list[np.ndarray]:
    return [np.full((40, 80, 3), 255, np.uint8) for _ in range(n)]


def test_claude_lee_un_lote_con_salida_estructurada() -> None:
    payload = {
        "readings": [
            {"index": 0, "text": "3^45", "confidence": 0.95},
            {"index": 1, "text": "14,00", "confidence": 0.99},
        ]
    }
    client, msgs = _client(payload)
    out = ClaudeTextReader(client).read(crops(2))
    assert out == [ReadText("3^45", 0.95), ReadText("14,00", 0.99)]
    call = msgs.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["output_config"]["format"]["type"] == "json_schema"
    images = [c for c in call["messages"][0]["content"] if c["type"] == "image"]
    assert len(images) == 2 and images[0]["source"]["media_type"] == "image/png"


def test_claude_rechazo_o_basura_no_rompe() -> None:
    client, _ = _client({"readings": []}, stop="refusal")
    assert ClaudeTextReader(client).read(crops(2)) == [ReadText("", 0.0)] * 2
    bad = SimpleNamespace(
        beta=SimpleNamespace(
            messages=SimpleNamespace(
                create=lambda **kw: SimpleNamespace(
                    stop_reason="end_turn", content=[SimpleNamespace(type="text", text="no")]
                )
            )
        )
    )
    assert ClaudeTextReader(bad).read(crops(1)) == [ReadText("", 0.0)]


def test_claude_parte_en_lotes() -> None:
    client, msgs = _client({"readings": []})
    ClaudeTextReader(client).read(crops(50))
    assert len(msgs.calls) == 3  # lotes de 24


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
