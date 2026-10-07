"""Evaluación contra planos REALES con verdad anotada a mano (tests/real/<caso>/truth.json).

Corre el mismo selector de detectores que producción, lleva el modelo detectado al marco de
la imagen original (homografía de la detección) y lo compara con la verdad en metros:

- muros: cobertura del eje (P/R/F1 a 15 cm, robusta a muros partidos) y F1 estricto de extremos
- aberturas: centro a menos de 30 cm y mismo tipo
- ambientes: IoU por ambiente verdadero, cantidad y nombre
- escala: error relativo de metros por píxel
- niveles: cantidad

Uso:
    python scripts/eval_real.py                 # todos los casos
    python scripts/eval_real.py casa1 --log "qué cambió"
Escribe calidad/<caso>/{metrics.json, overlay.png} y, con --log, una entrada en la bitácora.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from tests.synth.metrics import centerline_pr, opening_pr, wall_f1  # noqa: E402

from plano3d.application.dto import ProgressEventDTO  # noqa: E402
from plano3d.application.ports import DetectionRequest, ProgressPublisher  # noqa: E402
from plano3d.container import default_selector  # noqa: E402
from plano3d.domain import BuildingModel  # noqa: E402

CASES = ROOT / "tests" / "real"
OUT = ROOT.parent / "calidad"

#: criterio de aceptación acordado con el usuario
CRITERIA = {"wall_f1": 0.95, "room_iou": 0.90, "open_p": 0.90, "open_r": 0.90}

Pt = tuple[float, float]


class _Quiet(ProgressPublisher):
    async def publish(self, event: ProgressEventDTO) -> None:
        return None


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()


@dataclass
class Frame:
    """Detección (metros del modelo) → metros de la verdad, vía la imagen original."""

    h_inv: np.ndarray
    mpp: float
    origin: Pt
    px_per_m: float

    def to_truth(self, p: Pt) -> Pt:
        x, y, w = self.h_inv @ np.array([p[0] / self.mpp, p[1] / self.mpp, 1.0])
        return ((x / w - self.origin[0]) / self.px_per_m, (y / w - self.origin[1]) / self.px_per_m)


def truth_mpp_in_rectified(h: np.ndarray, origin: Pt, px_per_m: float) -> float:
    """Metros reales por píxel rectificado (promedio en x e y alrededor del origen)."""

    def warp(p: Pt) -> np.ndarray:
        v = h @ np.array([p[0], p[1], 1.0])
        return v[:2] / v[2]

    o = warp(origin)
    lx = float(np.linalg.norm(warp((origin[0] + px_per_m, origin[1])) - o))
    ly = float(np.linalg.norm(warp((origin[0], origin[1] + px_per_m)) - o))
    return 2.0 / (lx + ly)


def raster_iou(a: list[Pt], b: list[Pt], res: float = 0.02) -> float:
    pts = np.array(a + b)
    lo = pts.min(axis=0) - 0.1
    hi = pts.max(axis=0) + 0.1
    shape = (int((hi[1] - lo[1]) / res) + 1, int((hi[0] - lo[0]) / res) + 1)
    ma = np.zeros(shape, np.uint8)
    mb = np.zeros(shape, np.uint8)
    cv2.fillPoly(ma, [np.round((np.array(a) - lo) / res).astype(np.int32)], 1)
    cv2.fillPoly(mb, [np.round((np.array(b) - lo) / res).astype(np.int32)], 1)
    inter = int((ma & mb).sum())
    union = int((ma | mb).sum())
    return inter / union if union else 0.0


def opening_centers(walls: list[dict[str, Any]]) -> list[tuple[Pt, str]]:
    out: list[tuple[Pt, str]] = []
    for w in walls:
        (ax, ay), (bx, by) = w["a"], w["b"]
        length = math.dist((ax, ay), (bx, by)) or 1.0
        for o in w["openings"]:
            t = (o["from"] + o["to"]) / 2 / length
            out.append(((ax + (bx - ax) * t, ay + (by - ay) * t), o["kind"]))
    return out


def detected_level(model: BuildingModel, k: int, frame: Frame) -> dict[str, Any]:
    lv = model.levels[k]
    walls = []
    for w in lv.walls:
        a = frame.to_truth((w.start.x, w.start.y))
        b = frame.to_truth((w.end.x, w.end.y))
        length = math.dist(a, b) or 1.0
        mlen = w.length or 1.0
        walls.append(
            {
                "a": a,
                "b": b,
                "openings": [
                    {
                        "kind": o.kind.value,
                        "from": o.offset / mlen * length,
                        "to": (o.offset + o.width) / mlen * length,
                    }
                    for o in w.openings
                ],
            }
        )
    rooms = [
        {"label": r.label, "polygon": [frame.to_truth((p.x, p.y)) for p in r.polygon]}
        for r in lv.rooms
    ]
    return {"walls": walls, "rooms": rooms, "name": lv.name}


def score_level(det: dict[str, Any], gt: dict[str, Any]) -> dict[str, Any]:
    det_segs = [(tuple(w["a"]), tuple(w["b"])) for w in det["walls"]]
    gt_segs = [(tuple(w["a"]), tuple(w["b"])) for w in gt["walls"]]
    cp, cr = centerline_pr([list(s) for s in det_segs], [list(s) for s in gt_segs], 0.15, 0.05)
    cf = 2 * cp * cr / (cp + cr) if cp + cr else 0.0
    op, orr = opening_pr(opening_centers(det["walls"]), opening_centers(gt["walls"]), 0.30)

    room_rows = []
    used: set[int] = set()
    for g in gt["rooms"]:
        best, best_j = 0.0, -1
        for j, d in enumerate(det["rooms"]):
            if len(d["polygon"]) >= 3:
                iou = raster_iou([tuple(p) for p in g["polygon"]], [tuple(p) for p in d["polygon"]])
                if iou > best:
                    best, best_j = iou, j
        label = det["rooms"][best_j]["label"] if best_j >= 0 else ""
        ok_name = best_j >= 0 and any(
            n in norm(label) or norm(label) in n for n in map(norm, g["names"]) if norm(label)
        )
        used.add(best_j)
        room_rows.append(
            {
                "truth": g["names"][0],
                "iou": round(best, 3),
                "label": label,
                "name_ok": bool(ok_name),
            }
        )
    return {
        "walls_det": len(det_segs),
        "walls_gt": len(gt_segs),
        "wall_p": round(cp, 3),
        "wall_r": round(cr, 3),
        "wall_f1": round(cf, 3),
        "wall_f1_ends": round(wall_f1(det_segs, gt_segs, 0.15), 3),
        "open_p": round(op, 3),
        "open_r": round(orr, 3),
        "open_det": len(opening_centers(det["walls"])),
        "open_gt": len(opening_centers(gt["walls"])),
        "rooms_det": len(det["rooms"]),
        "rooms_gt": len(gt["rooms"]),
        "room_iou": round(float(np.mean([r["iou"] for r in room_rows])) if room_rows else 0.0, 3),
        "names_ok": sum(r["name_ok"] for r in room_rows),
        "rooms": room_rows,
    }


def overlay(img: np.ndarray, truth: dict[str, Any], dets: list[dict[str, Any]], path: Path) -> None:
    out = img.copy()
    ppm = truth["px_per_m"]
    ox, oy = truth["origin_px"]

    def px(p: Pt) -> tuple[int, int]:
        return (round(ox + p[0] * ppm), round(oy + p[1] * ppm))

    for lv in truth["levels"]:
        lo = lv.get("origin_px")
        if lo:  # cada planta de una lámina tiene su propio origen
            ox, oy = lo
        for w in lv["walls"]:
            cv2.line(out, px(w["a"]), px(w["b"]), (60, 200, 60), 6)
        ox, oy = truth["origin_px"]
    for det in dets:
        for r in det["rooms"]:
            cv2.polylines(
                out, [np.array([px(p) for p in r["polygon"]], np.int32)], True, (200, 60, 200), 2
            )
            c = np.mean(np.array([px(p) for p in r["polygon"]]), axis=0).astype(int)
            cv2.putText(
                out,
                r["label"][:18],
                tuple(int(v) for v in c),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (150, 0, 150),
                1,
            )
        for w in det["walls"]:
            cv2.line(out, px(w["a"]), px(w["b"]), (40, 40, 230), 2)
            (ax, ay), (bx, by) = w["a"], w["b"]
            length = math.dist((ax, ay), (bx, by)) or 1.0
            for o in w["openings"]:
                t0, t1 = o["from"] / length, o["to"] / length
                p0 = (ax + (bx - ax) * t0, ay + (by - ay) * t0)
                p1 = (ax + (bx - ax) * t1, ay + (by - ay) * t1)
                color = (230, 120, 0) if o["kind"] == "window" else (0, 150, 255)
                cv2.line(out, px(p0), px(p1), color, 4)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), out)


async def evaluate(case: str) -> dict[str, Any]:
    folder = CASES / case
    truth = json.loads((folder / "truth.json").read_text(encoding="utf-8"))
    image_path = folder / truth["image"]
    data = image_path.read_bytes()
    ctype = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"
    selector = default_selector()
    detector = selector.choose(data, ctype)
    result = await detector.detect(DetectionRequest(case, data, ctype, None), _Quiet())
    model = result.model
    h = np.array(result.image_transform or np.eye(3).ravel(), np.float64).reshape(3, 3)
    origin = tuple(truth["origin_px"])
    frame = Frame(np.linalg.inv(h), model.scale.meters_per_pixel, origin, truth["px_per_m"])

    true_mpp = truth_mpp_in_rectified(h, origin, truth["px_per_m"])
    scale_err = model.scale.meters_per_pixel / true_mpp - 1.0

    dets = [detected_level(model, k, frame) for k in range(len(model.levels))]
    levels = []
    for k, gt in enumerate(truth["levels"]):
        if k < len(dets):
            levels.append({"name": gt["name"], **score_level(dets[k], gt)})
        else:
            levels.append({"name": gt["name"], "missing": True})

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    overlay(img, truth, dets, OUT / case / "overlay.png")

    report = {
        "case": case,
        "detector": detector.name,
        "metrics": result.metrics,
        "scale": {
            "mpp": model.scale.meters_per_pixel,
            "source": model.scale.source,
            "error": round(scale_err, 4),
        },
        "levels_det": len(model.levels),
        "levels_gt": len(truth["levels"]),
        "levels": levels,
        "when": datetime.now().isoformat(timespec="seconds"),
    }
    report["pass"] = passes(report, truth)
    (OUT / case).mkdir(parents=True, exist_ok=True)
    (OUT / case / "metrics.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return report


def passes(report: dict[str, Any], truth: dict[str, Any]) -> dict[str, bool]:
    checks: dict[str, bool] = {
        "scale": abs(report["scale"]["error"]) <= truth.get("scale_tolerance", 0.05),
        "levels": report["levels_det"] == report["levels_gt"],
    }
    for lv in report["levels"]:
        n = lv["name"]
        if lv.get("missing"):
            checks[f"{n}: presente"] = False
            continue
        checks[f"{n}: muros"] = lv["wall_f1"] >= CRITERIA["wall_f1"]
        checks[f"{n}: aberturas"] = (
            lv["open_p"] >= CRITERIA["open_p"] and lv["open_r"] >= CRITERIA["open_r"]
        )
        checks[f"{n}: ambientes"] = (
            lv["rooms_det"] == lv["rooms_gt"] and lv["room_iou"] >= CRITERIA["room_iou"]
        )
        checks[f"{n}: nombres"] = lv["names_ok"] == lv["rooms_gt"]
    return checks


def summary(r: dict[str, Any]) -> str:
    sc = r["scale"]
    lines = [
        f"## {r['case']}  ({r['detector']})  escala {sc['source']} error {sc['error']:+.1%}  "
        f"niveles {r['levels_det']}/{r['levels_gt']}"
    ]
    for lv in r["levels"]:
        if lv.get("missing"):
            lines.append(f"- {lv['name']}: NO DETECTADO")
            continue
        walls = (
            f"muros F1 {lv['wall_f1']:.2f} (P {lv['wall_p']:.2f} R {lv['wall_r']:.2f}, "
            f"extremos {lv['wall_f1_ends']:.2f}, {lv['walls_det']}/{lv['walls_gt']})"
        )
        opens = (
            f"aberturas P {lv['open_p']:.2f} R {lv['open_r']:.2f} "
            f"({lv['open_det']}/{lv['open_gt']})"
        )
        rooms = (
            f"ambientes {lv['rooms_det']}/{lv['rooms_gt']} IoU {lv['room_iou']:.2f} "
            f"nombres {lv['names_ok']}/{lv['rooms_gt']}"
        )
        lines.append(f"- {lv['name']}: {walls} · {opens} · {rooms}")
    fails = [k for k, ok in r["pass"].items() if not ok]
    lines.append("- **CUMPLE**" if not fails else f"- falta: {', '.join(fails)}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="*")
    ap.add_argument("--log", help="anota el resultado en calidad/bitacora.md con este mensaje")
    args = ap.parse_args()
    cases = args.cases or sorted(p.name for p in CASES.iterdir() if (p / "truth.json").exists())
    texts = [summary(asyncio.run(evaluate(c))) for c in cases]
    text = "\n\n".join(texts)
    print(text)
    if args.log:
        log = OUT / "bitacora.md"
        head = (
            ""
            if log.exists()
            else "# Bitácora de calidad: planos reales\n\n"
            "Cada entrada: cambio y métricas resultantes (scripts/eval_real.py).\n"
        )
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        with log.open("a", encoding="utf-8") as f:
            f.write(f"{head}\n### {stamp} — {args.log}\n\n{text}\n")


if __name__ == "__main__":
    main()
