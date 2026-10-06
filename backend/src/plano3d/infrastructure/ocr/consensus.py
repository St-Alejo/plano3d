"""Composite: dos lectores leen los mismos recortes y se comparan (ADR-014).

- Si los dos dan el mismo VALOR (no el mismo texto: "3,45" = "3.45" = "345" cm), la
  lectura es firme (confianza alta).
- Si solo uno da una medida válida, se toma con su confianza.
- Si discrepan, gana el lector de mayor jerarquía (el segundo, p. ej. Claude) pero con
  confianza baja: el solver le dará poco peso y la marcará para revisión si no encaja.
"""

from __future__ import annotations

from collections.abc import Sequence

from plano3d.application.ports import Image, ReadText, TextReader
from plano3d.domain.plan_text import parse_length

AGREE = 0.98
DISAGREE = 0.35


def _value(t: ReadText) -> float | None:
    p = parse_length(t.text.replace(" ", ""))
    return p.meters if p else None


class ConsensusReader(TextReader):
    name = "consenso"

    def __init__(self, first: TextReader, second: TextReader) -> None:
        self._first = first
        self._second = second

    def read(self, crops: Sequence[Image]) -> list[ReadText]:
        a = self._first.read(crops)
        b = self._second.read(crops)
        out = []
        for ra, rb in zip(a, b, strict=True):
            va, vb = _value(ra), _value(rb)
            if va is not None and vb is not None:
                if abs(va - vb) < 1e-6:
                    out.append(ReadText(rb.text, max(AGREE, ra.confidence, rb.confidence)))
                else:
                    out.append(ReadText(rb.text, DISAGREE))
            elif vb is not None:
                out.append(rb)
            elif va is not None:
                out.append(ra)
            else:
                out.append(ReadText("", 0.0))
        return out
