"""Métricas de calidad del detector (sección 11 del documento de arquitectura).

Uso:
    python scripts/eval.py                   # benchmark sintético básico (reproducible)
    python scripts/eval.py --suite complex   # planos complejos (Fase 0 del plan de modelado)
    python scripts/eval.py --suite all       # ambos
    python scripts/eval.py --real DIR        # además, fotos reales anotadas

Suite compleja: casa con muro curvo/diagonal/columnas/escalera y edificio multi-unidad, en
estilos CAD doble línea, achurado, relleno y boceto, escaneados y fotografiados. Mide, en
píxeles de la imagen rectificada (independiente de la escala detectada):
- F1 de muros por extremos con tolerancia de 5 y 15 cm, y cobertura del eje (P/R a 10 cm);
- aberturas por POSICIÓN (centro a 30 cm, mismo tipo);
- exactitud de MEDIDAS: % de muros cuyo largo en metros difiere < 1 cm del real,
  error medio en cm y error de la escala;
- ambientes (conteo exacto e IoU) y % de cotas del plano presentes en el modelo.

Benchmark sintético: planos conocidos fotografiados con dificultad creciente
(perspectiva, sombra, ruido, desenfoque). Mide IoU de habitaciones, conteo de
ambientes y precisión/exhaustividad de puertas y ventanas, y la latencia.

Set real (golden set), por cada `foto.jpg` una o ambas anotaciones:
- `foto.json` con conteos: {"rooms": 4, "doors": 3, "windows": 2}
- `foto.model.json`: el BuildingModel CORREGIDO en el editor (tal cual lo devuelve
  `GET /api/projects/{id}` en el campo `model`). Es la verdad de terreno completa: se
  reporta la tasa de corrección (muros movidos/agregados/borrados) que haría falta.
Es informativo: no bloquea CI, sirve para medir el avance entre fases.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.pipeline.conftest import (
    Case,
    photo_case,
    photo_case_from,
    scan_case_from,
)
from tests.synth.complex_plans import (
    COMPLEX_PLANS,
    STYLES,
    ComplexPlan,
    render_complex,
)
from tests.synth.metrics import (
    Seg,
    centerline_pr,
    match_segments,
    opening_pr,
    wall_f1,
)
from tests.synth.plan_generator import polygon_iou

from plano3d.application.dto import BuildingModelDTO, model_from_dto
from plano3d.container import wall_segmenter
from plano3d.domain.quality import correction_stats
from plano3d.infrastructure.cv.classic_cv_detector import default_stages
from plano3d.infrastructure.cv.context import CVContext

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
    for stage in default_stages(None, _SEGMENTER):
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
                except (
                    Exception
                ) as exc:  # una foto irreconocible cuenta como fallo, no rompe el reporte
                    rows.append(Row(level, False, 0, 0, 0, 0, 0, 0, str(exc)))
                    continue
                assert ctx.rectified is not None
                shape = ctx.rectified.shape[:2]
                ious = [
                    max(
                        (polygon_iou(r.polygon, case.gt_points(gt), shape) for r in ctx.rooms),
                        default=0,
                    )
                    for gt in case.rendered.rooms_px
                ]
                ops = [o for s in ctx.segments for o in s.openings]
                dp, dr = pr(sum(o.kind == "door" for o in ops), case.plan.door_count)
                wp, wr = pr(sum(o.kind == "window" for o in ops), case.plan.window_count)
                rows.append(
                    Row(
                        level,
                        len(ctx.rooms) == len(case.plan.rooms),
                        statistics.mean(ious),
                        dp,
                        dr,
                        wp,
                        wr,
                        ms,
                    )
                )
    return rows


def report(rows: list[Row]) -> None:
    print(
        f"\n{'dificultad':<10} {'n':>3} {'ambientes OK':>13} {'IoU amb.':>9} "
        f"{'puertas P/R':>12} {'ventanas P/R':>13} {'ms':>6}"
    )
    for level in LEVELS:
        rs = [r for r in rows if r.level == level]
        if not rs:
            continue
        m = statistics.mean
        print(
            f"{level:<10} {len(rs):>3} {m(r.ok_rooms for r in rs):>12.0%} "
            f"{m(r.room_iou for r in rs):>9.3f} "
            f"{m(r.door_p for r in rs):>5.2f}/{m(r.door_r for r in rs):<5.2f} "
            f"{m(r.window_p for r in rs):>6.2f}/{m(r.window_r for r in rs):<5.2f} "
            f"{m(r.ms for r in rs):>6.0f}"
        )
    failures = [r for r in rows if r.error]
    if failures:
        print(f"\n{len(failures)} foto(s) sin resultado: {failures[0].error}")


def real(directory: Path) -> None:
    print(f"\nSet real: {directory}")
    rates: list[float] = []
    for img in sorted(directory.glob("*.jp*g")) + sorted(directory.glob("*.png")):
        counts_path = img.with_suffix(".json")
        model_path = img.with_name(img.stem + ".model.json")
        if not counts_path.exists() and not model_path.exists():
            continue
        ctype = "image/png" if img.suffix == ".png" else "image/jpeg"
        try:
            ctx, ms = run(img.read_bytes(), ctype)
        except Exception as exc:
            print(f"  {img.name:<30} FALLÓ: {exc}")
            continue
        parts = []
        if counts_path.exists():
            ann = json.loads(counts_path.read_text(encoding="utf-8"))
            ops = [o for s in ctx.segments for o in s.openings]
            got = {
                "rooms": len(ctx.rooms),
                "doors": sum(o.kind == "door" for o in ops),
                "windows": sum(o.kind == "window" for o in ops),
            }
            parts.append("  ".join(f"{k} {got[k]}/{ann.get(k, '?')}" for k in got))
        if model_path.exists() and ctx.model is not None:
            truth = model_from_dto(
                BuildingModelDTO.model_validate_json(model_path.read_text(encoding="utf-8"))
            )
            # misma foto → misma imagen rectificada: se lleva la detección a la escala verdadera
            detected = ctx.model.recalibrated(truth.scale.meters_per_pixel)
            st = correction_stats(detected, truth)
            rates.append(st.correction_rate)
            parts.append(
                f"corrección {st.correction_rate:.0%} "
                f"(mov {st.walls_moved}, +{st.walls_added}, -{st.walls_deleted}; "
                f"área {st.area_detected_m2:.1f}/{st.area_final_m2:.1f} m²)"
            )
        print(f"  {img.name:<30} {'  |  '.join(parts)}  ({ms:.0f} ms)")
    if rates:
        print(f"\n  Tasa de corrección media: {statistics.mean(rates):.0%} en {len(rates)} planos")


# ----------------------------------------------------------------------------- suite compleja

PHOTO = {"tilt": 0.08, "shadow": 0.35, "noise": 6, "blur": 1.0}


@dataclass
class ComplexRow:
    plan: str
    style: str
    mode: str
    f1_5: float = 0.0
    f1_15: float = 0.0
    axis_p: float = 0.0
    axis_r: float = 0.0
    op_p: float = 0.0
    op_r: float = 0.0
    exact_1cm: float = 0.0
    len_err_cm: float = float("nan")
    scale_err: float = float("nan")
    rooms_ok: bool = False
    room_iou: float = 0.0
    dims_read: float = 0.0
    ms: float = 0.0
    error: str | None = None


GtOpening = tuple[tuple[float, float], str]


def _to_work(case: Case, ctx: CVContext, pts: np.ndarray) -> np.ndarray:
    """Papel → imagen de trabajo, con la homografía real que aplicó el pipeline."""
    h = ctx.transform @ case.paper_to_input
    out = cv2.perspectiveTransform(np.asarray(pts, np.float64).reshape(-1, 1, 2), h)
    return np.asarray(out.reshape(-1, 2), np.float64)


def _gt(
    case: Case, ctx: CVContext
) -> tuple[list[Seg], list[list[tuple[float, float]]], list[GtOpening], float]:
    """Muros (cuerdas), ejes muestreados, aberturas y px/m en la imagen de trabajo."""
    r = case.rendered
    plan = case.plan

    def px(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
        arr = _to_work(case, ctx, np.array([r.to_px(p) for p in pts], np.float64))
        return [(float(x), float(y)) for x, y in arr]

    segs: list[Seg] = []
    axes = []
    ops: list[GtOpening] = []
    for w in plan.walls:
        a, b = px([w.a, w.b])
        segs.append((a, b))
        axes.append(px(w.axis_points()))
        ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
        for o in w.openings:
            c = o.offset + o.width / 2
            ops.append((px([(w.a[0] + ux * c, w.a[1] + uy * c)])[0], o.kind))
    o0, ox = px([(0.0, 0.0), (plan.width_m, 0.0)])
    _, oy = px([(0.0, 0.0), (0.0, plan.height_m)])
    ppm = (math.dist(o0, ox) / plan.width_m + math.dist(o0, oy) / plan.height_m) / 2
    return segs, axes, ops, ppm


DETECTOR = "classic"
#: red de muros si PLANO3D_SEG_MODEL=1 (para comparar con y sin ella)
_SEGMENTER = wall_segmenter()
_READER = None


def run_raster(data: bytes, ctype: str) -> tuple[CVContext, float]:
    """Estrategia raster-vector: devuelve el contexto clásico con el modelo nuevo."""
    global _READER
    from plano3d.infrastructure.cv.raster_vector_detector import run_sync
    from plano3d.infrastructure.ocr.rapid import RapidOcrReader, available

    if _READER is None and available():
        _READER = RapidOcrReader()
    t0 = time.perf_counter()
    rctx = run_sync("eval", data, ctype, _READER)
    ms = (time.perf_counter() - t0) * 1000
    cv = rctx.require(rctx.cv, "cv")
    cv.model = rctx.model
    return cv, ms


def evaluate_case(case: Case, plan_name: str, style: str, mode: str) -> ComplexRow:
    row = ComplexRow(plan_name, style, mode)
    try:
        runner = run_raster if DETECTOR == "raster" else run
        ctx, row.ms = runner(case.data, case.content_type)
    except Exception as exc:  # un plano irreconocible cuenta como fallo, no rompe el reporte
        row.error = f"{type(exc).__name__}: {exc}"
        return row
    model = ctx.model
    if model is None or not model.levels:
        row.error = "sin modelo"
        return row
    mpp = model.scale.meters_per_pixel
    gt_segs, gt_axes, gt_ops, ppm = _gt(case, ctx)
    walls = [w for lv in model.levels for w in lv.walls]
    det: list[Seg] = [
        ((w.start.x / mpp, w.start.y / mpp), (w.end.x / mpp, w.end.y / mpp)) for w in walls
    ]
    row.f1_5 = wall_f1(det, gt_segs, 0.05 * ppm)
    row.f1_15 = wall_f1(det, gt_segs, 0.15 * ppm)
    row.axis_p, row.axis_r = centerline_pr([list(s) for s in det], gt_axes, 0.10 * ppm, 0.1 * ppm)
    det_ops: list[GtOpening] = []
    for w in walls:
        length = w.length or 1.0
        for o in w.openings:
            t = (o.offset + o.width / 2) / length
            c = (w.start.x + (w.end.x - w.start.x) * t, w.start.y + (w.end.y - w.start.y) * t)
            det_ops.append(((c[0] / mpp, c[1] / mpp), o.kind.value))
    row.op_p, row.op_r = opening_pr(det_ops, gt_ops, 0.30 * ppm)
    # exactitud de medidas: largo en METROS del modelo frente al real (muros rectos)
    straight = [j for j, w in enumerate(case.plan.walls) if abs(w.bulge) < 1e-9]
    pairs = [(i, j) for i, j in match_segments(det, gt_segs, 0.15 * ppm) if j in straight]
    errs = [abs(walls[i].length - case.plan.walls[j].length) for i, j in pairs]
    if errs:
        row.exact_1cm = sum(e < 0.01 for e in errs) / len(straight)
        row.len_err_cm = statistics.mean(errs) * 100
    row.scale_err = abs(mpp * ppm - 1.0)
    # ambientes
    lv = model.levels[0]
    shape = ctx.require(ctx.rectified, "rectified").shape[:2]
    det_rooms = [np.array([(p.x / mpp, p.y / mpp) for p in r.polygon]) for r in lv.rooms]
    ious = [
        max((polygon_iou(d, _to_work(case, ctx, g), shape) for d in det_rooms), default=0.0)
        for g in case.rendered.rooms_px
    ]
    row.room_iou = statistics.mean(ious) if ious else 0.0
    row.rooms_ok = len(lv.rooms) == len(case.plan.rooms) and row.room_iou > 0.85
    # cotas del plano presentes en el modelo (a 1 cm), cuando el modelo las tenga
    plan = case.plan
    values = [d.value for lv in model.levels for d in lv.dimensions]
    if isinstance(plan, ComplexPlan) and plan.dimensions:
        hit = sum(
            any(v is not None and abs(v - g.value) < 0.01 for v in values) for g in plan.dimensions
        )
        row.dims_read = hit / len(plan.dimensions)
    return row


def complex_suite(seeds: int) -> list[ComplexRow]:
    rows: list[ComplexRow] = []
    for plan_name, factory in COMPLEX_PLANS.items():
        plan = factory()
        for style_name, style in STYLES.items():
            rendered = render_complex(plan, style)
            case = scan_case_from(rendered, f"{plan_name}-{style_name}-scan")
            rows.append(evaluate_case(case, plan_name, style_name, "escaneo"))
            for seed in range(seeds):
                params = dict(PHOTO)
                if style_name == "boceto":
                    params["fold"] = 0.004
                try:
                    case = photo_case_from(
                        rendered, f"{plan_name}-{style_name}-{seed}", seed, **params
                    )
                except AssertionError as exc:
                    rows.append(ComplexRow(plan_name, style_name, "foto", error=str(exc)))
                    continue
                rows.append(evaluate_case(case, plan_name, style_name, "foto"))
    return rows


def complex_report(rows: list[ComplexRow]) -> None:
    print(
        f"\n{'plano':<14} {'estilo':<9} {'modo':<8} {'n':>2} {'F1@5':>5} {'F1@15':>5} "
        f"{'eje P/R':>9} {'aber P/R':>9} {'<1cm':>5} {'err cm':>6} {'esc.':>5} "
        f"{'amb OK':>6} {'IoU':>5} {'cotas':>5} {'ms':>5}"
    )
    m = statistics.mean
    keys = sorted({(r.plan, r.style, r.mode) for r in rows})
    for plan, style, mode in keys:
        rs = [r for r in rows if (r.plan, r.style, r.mode) == (plan, style, mode)]
        ok = [r for r in rs if not r.error]
        if not ok:
            print(f"{plan:<14} {style:<9} {mode:<8} {len(rs):>2}  FALLÓ: {rs[0].error}")
            continue
        errs = [r.len_err_cm for r in ok if not math.isnan(r.len_err_cm)]
        print(
            f"{plan:<14} {style:<9} {mode:<8} {len(rs):>2} {m(r.f1_5 for r in ok):>5.2f} "
            f"{m(r.f1_15 for r in ok):>5.2f} "
            f"{m(r.axis_p for r in ok):>4.2f}/{m(r.axis_r for r in ok):<4.2f} "
            f"{m(r.op_p for r in ok):>4.2f}/{m(r.op_r for r in ok):<4.2f} "
            f"{m(r.exact_1cm for r in ok):>5.0%} {(m(errs) if errs else math.nan):>6.1f} "
            f"{m(r.scale_err for r in ok):>5.0%} {m(r.rooms_ok for r in ok):>6.0%} "
            f"{m(r.room_iou for r in ok):>5.2f} {m(r.dims_read for r in ok):>5.0%} "
            f"{m(r.ms for r in ok):>5.0f}"
        )
    ok = [r for r in rows if not r.error]
    if ok:
        print(
            f"\nGLOBAL  F1@15 {m(r.f1_15 for r in ok):.2f} · "
            f"medidas <1cm {m(r.exact_1cm for r in ok):.0%} · "
            f"error de escala {m(r.scale_err for r in ok):.0%} · "
            f"ambientes OK {m(r.rooms_ok for r in ok):.0%} · "
            f"cotas leídas {m(r.dims_read for r in ok):.0%} · "
            f"fallos {len(rows) - len(ok)}/{len(rows)}"
        )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--suite", choices=["basic", "complex", "all"], default="basic")
    ap.add_argument("--real", type=Path)
    ap.add_argument("--detector", choices=["classic", "raster"], default="classic")
    args = ap.parse_args()
    DETECTOR = args.detector
    if args.suite in ("basic", "all"):
        report(synthetic(args.seeds))
    if args.suite in ("complex", "all"):
        complex_report(complex_suite(min(args.seeds, 2)))
    if args.real:
        real(args.real)
