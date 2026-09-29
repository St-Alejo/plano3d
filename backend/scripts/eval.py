"""Métricas de calidad del detector (sección 11 del documento de arquitectura).

Uso:
    python scripts/eval.py                 # benchmark sintético (reproducible)
    python scripts/eval.py --real DIR      # además, fotos reales anotadas

Benchmark sintético: planos conocidos fotografiados con dificultad creciente
(perspectiva, sombra, ruido, desenfoque). Mide IoU de habitaciones, conteo de
ambientes y precisión/exhaustividad de puertas y ventanas, y la latencia.

Set real (golden set): por cada `foto.jpg` un `foto.json` con lo que hay en el plano:
    {"rooms": 4, "doors": 3, "windows": 2}
Es informativo: no bloquea CI, sirve para medir el avance entre fases.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from plano3d.infrastructure.cv.classic_cv_detector import default_stages  # noqa: E402
from plano3d.infrastructure.cv.context import CVContext  # noqa: E402
from tests.pipeline.conftest import photo_case  # noqa: E402
from tests.synth.plan_generator import polygon_iou  # noqa: E402

LEVELS = {
    "suave": {"tilt": 0.04, "shadow": 0.2, "noise": 4, "blur": 0.6},
    "media": {"tilt": 0.08, "shadow": 0.35, "noise": 6, "blur": 1.0},
    "difícil": {"tilt": 0.12, "shadow": 0.55, "noise": 10, "blur": 1.6},
}


@dataclass
class Row:
    level: str
    ok_rooms: bool
    room_iou: float
    door_p: float
    door_r: float
    window_p: float
    window_r: float
    ms: float
    error: str | None = None


def run(data: bytes, ctype: str) -> tuple[CVContext, float]:
    ctx = CVContext("eval", data, ctype)
    t0 = time.perf_counter()
    for stage in default_stages():
        ctx = stage.run(ctx)
    return ctx, (time.perf_counter() - t0) * 1000


def pr(found: int, expected: int) -> tuple[float, float]:
    hits = min(found, expected)
    return (hits / found if found else 1.0, hits / expected if expected else 1.0)


def synthetic(seeds: int) -> list[Row]:
    rows: list[Row] = []
    for level, params in LEVELS.items():
        for plan in ("apartment", "l_house"):
            for seed in range(seeds):
                case = photo_case(plan, seed, **params)
                try:
                    ctx, ms = run(case.data, "image/jpeg")
                except Exception as exc:  # una foto irreconocible cuenta como fallo, no rompe el reporte
                    rows.append(Row(level, False, 0, 0, 0, 0, 0, 0, str(exc)))
                    continue
                assert ctx.rectified is not None
                shape = ctx.rectified.shape[:2]
                ious = [
                    max((polygon_iou(r.polygon, case.gt_points(gt), shape) for r in ctx.rooms), default=0)
                    for gt in case.rendered.rooms_px
                ]
                ops = [o for s in ctx.segments for o in s.openings]
                dp, dr = pr(sum(o.kind == "door" for o in ops), case.plan.door_count)
                wp, wr = pr(sum(o.kind == "window" for o in ops), case.plan.window_count)
                rows.append(
                    Row(level, len(ctx.rooms) == len(case.plan.rooms), statistics.mean(ious),
                        dp, dr, wp, wr, ms)
                )
    return rows


def report(rows: list[Row]) -> None:
    print(f"\n{'dificultad':<10} {'n':>3} {'ambientes OK':>13} {'IoU amb.':>9} "
          f"{'puertas P/R':>12} {'ventanas P/R':>13} {'ms':>6}")
    for level in LEVELS:
        rs = [r for r in rows if r.level == level]
        if not rs:
            continue
        m = statistics.mean
        print(
            f"{level:<10} {len(rs):>3} {m(r.ok_rooms for r in rs):>12.0%} {m(r.room_iou for r in rs):>9.3f} "
            f"{m(r.door_p for r in rs):>5.2f}/{m(r.door_r for r in rs):<5.2f} "
            f"{m(r.window_p for r in rs):>6.2f}/{m(r.window_r for r in rs):<5.2f} {m(r.ms for r in rs):>6.0f}"
        )
    failures = [r for r in rows if r.error]
    if failures:
        print(f"\n{len(failures)} foto(s) sin resultado: {failures[0].error}")


def real(directory: Path) -> None:
    print(f"\nSet real: {directory}")
    for img in sorted(directory.glob("*.jp*g")) + sorted(directory.glob("*.png")):
        ann_path = img.with_suffix(".json")
        if not ann_path.exists():
            continue
        ann = json.loads(ann_path.read_text(encoding="utf-8"))
        ctype = "image/png" if img.suffix == ".png" else "image/jpeg"
        try:
            ctx, ms = run(img.read_bytes(), ctype)
        except Exception as exc:
            print(f"  {img.name:<30} FALLÓ: {exc}")
            continue
        ops = [o for s in ctx.segments for o in s.openings]
        got = {
            "rooms": len(ctx.rooms),
            "doors": sum(o.kind == "door" for o in ops),
            "windows": sum(o.kind == "window" for o in ops),
        }
        detail = "  ".join(f"{k} {got[k]}/{ann.get(k, '?')}" for k in got)
        print(f"  {img.name:<30} {detail}  ({ms:.0f} ms)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--real", type=Path)
    args = ap.parse_args()
    report(synthetic(args.seeds))
    if args.real:
        real(args.real)
