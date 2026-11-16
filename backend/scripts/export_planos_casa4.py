"""Dibuja los planos de la casa destacada de 4 pisos (un PDF vectorial y un PNG por piso).

    python -m scripts.export_planos_casa4 [carpeta]   (por defecto ../presentacion/planos-casa4)

Lee el fixture ``casa4.json`` y lo pasa por los dibujantes de planos sintéticos de las pruebas
(``tests/synth``): muros con su espesor, puertas con su barrido, ventanas, escalera, columnas,
cotas y el nombre de cada ambiente, como un plano impreso a escala 1:50. Son los mismos planos
que se pueden subir por el chat para rehacer la casa.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

from plano3d.infrastructure.demo import FEATURED_PROJECT_ID, FIXTURES
from tests.synth.complex_plans import (
    ComplexPlan,
    Style,
    SynthColumn,
    SynthStair,
    _rooms_from_axes,
    dimension_chains,
    render_complex,
)
from tests.synth.plan_generator import SynthOpening, SynthWall
from tests.synth.to_pdf import plan_to_pdf

DATA = Path(__file__).resolve().parents[1] / "src/plano3d/infrastructure/demo/data"
OUT = Path(__file__).resolve().parents[2] / "presentacion/planos-casa4"


def level_plan(level: dict, width: float, height: float) -> ComplexPlan:
    walls = tuple(
        SynthWall(
            (w["start"]["x"], w["start"]["y"]),
            (w["end"]["x"], w["end"]["y"]),
            w["thickness"],
            tuple(SynthOpening(o["offset"], o["width"], o["kind"]) for o in w["openings"]),
        )
        for w in level["walls"]
    )
    axes = [
        (r["label"].upper(), [(p["x"], p["y"]) for p in r["polygon"]])
        for r in level["rooms"]
        if r["room_type"] != "stairs"
    ]
    stairs = []
    for s in level["stairs"]:
        (x0, y0), (x1, y1) = (s["start"]["x"], s["start"]["y"]), (s["end"]["x"], s["end"]["y"])
        half = s["width"] / 2
        if abs(x0 - x1) < 1e-6:  # sube a lo largo de y
            stairs.append(SynthStair(x0 - half, min(y0, y1), x0 + half, max(y0, y1), s["steps"], "y"))
        else:
            stairs.append(SynthStair(min(x0, x1), y0 - half, max(x0, x1), y0 + half, s["steps"], "x"))
    xs = sorted({p["x"] for r in level["rooms"] for p in r["polygon"]} - {0.0, width})
    ys = sorted({p["y"] for r in level["rooms"] for p in r["polygon"]} - {0.0, height})
    mark = f"N+{level['elevation']:.2f}".replace(".", ",")
    return ComplexPlan(
        width_m=width,
        height_m=height,
        walls=walls,
        rooms=_rooms_from_axes(walls, axes),
        name=level["name"],
        columns=tuple(
            SynthColumn((c["center"]["x"], c["center"]["y"]), c["width"], c["round"])
            for c in level["columns"]
        ),
        stairs=tuple(stairs),
        dimensions=dimension_chains(xs, ys, width, height),
        level_mark=mark,
    )


def main(out: Path = OUT) -> None:
    model = json.loads((DATA / FIXTURES[FEATURED_PROJECT_ID]).read_text(encoding="utf-8"))["model"]
    xs = [w[k]["x"] for lv in model["levels"] for w in lv["walls"] for k in ("start", "end")]
    ys = [w[k]["y"] for lv in model["levels"] for w in lv["walls"] for k in ("start", "end")]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    out.mkdir(parents=True, exist_ok=True)
    levels = sorted(model["levels"], key=lambda lv: lv["elevation"])
    for n, level in enumerate(levels, 1):
        plan = level_plan(level, width, height)
        (out / f"piso-{n}.pdf").write_bytes(plan_to_pdf(plan))
        rendered = render_complex(plan, Style(furniture=False), px_per_m=90)
        cv2.imwrite(str(out / f"piso-{n}.png"), rendered.image)
        print(f"piso {n}: {level['name']} -> piso-{n}.pdf / .png")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
