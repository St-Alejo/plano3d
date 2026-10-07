"""Exporta los planos corregidos en el editor como datos de entrenamiento (ciclo de uso).

Cada proyecto que el usuario guardó al menos una vez (revisión ≥ 1) aporta un par
imagen/máscara: la imagen rectificada del análisis y los muros de su modelo final
(lo que el usuario dejó como correcto), rasterizados en esos mismos píxeles. Con esos
pares, ``ml/train_seg.py --real-dir`` puede afinar la red; el modelo nuevo solo se
publica si mejora la evaluación (``scripts/eval_real.py``).

Uso: ``python scripts/export_dataset.py --out ml/data/correcciones`` (con la misma
configuración PLANO3D_* que el servidor).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from plano3d.config import Settings  # noqa: E402
from plano3d.container import build_container  # noqa: E402
from plano3d.domain import Level  # noqa: E402


def wall_mask(level: Level, mpp: float, shape: tuple[int, int]) -> np.ndarray:
    """Muros del nivel (sin los vanos) en píxeles de la imagen rectificada."""
    mask = np.zeros(shape, np.uint8)
    for w in level.walls:
        length = w.length
        if length <= 0 or w.bulge:
            continue
        ux, uy = (w.end.x - w.start.x) / length, (w.end.y - w.start.y) / length
        nx, ny = -uy, ux
        h = w.thickness / 2
        cuts = [0.0]
        for o in sorted(w.openings, key=lambda o: o.offset):
            cuts += [o.offset, o.offset + o.width]
        cuts.append(length)
        for f, t in zip(cuts[::2], cuts[1::2], strict=True):
            if t - f <= 0.01:
                continue
            f0 = f - (h if f == 0 else 0.0)
            t0 = t + (h if math.isclose(t, length) else 0.0)
            p0 = (w.start.x + ux * f0, w.start.y + uy * f0)
            p1 = (w.start.x + ux * t0, w.start.y + uy * t0)
            quad = [
                (p0[0] + nx * h, p0[1] + ny * h),
                (p1[0] + nx * h, p1[1] + ny * h),
                (p1[0] - nx * h, p1[1] - ny * h),
                (p0[0] - nx * h, p0[1] - ny * h),
            ]
            cv2.fillPoly(mask, [np.round(np.array(quad) / mpp).astype(np.int32)], 255)
    return mask


async def export(out: Path) -> int:
    container = await build_container(Settings())
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    try:
        for project in await container.repo.list():
            model = project.model
            src = model.source_image if model else None
            if model is None or project.revision < 1 or src is None or not src.key:
                continue
            data = await container.storage.get(src.key)
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            # niveles apilados en una lámina: cada uno tendría su propia imagen; aquí
            # solo se exporta el primero, que es el que corresponde a la rectificada
            mask = wall_mask(model.levels[0], model.scale.meters_per_pixel, img.shape[:2])
            cv2.imwrite(str(out / f"{project.id}.png"), img)
            cv2.imwrite(str(out / f"{project.id}_muros.png"), mask)
            meta = {"project": project.id, "revision": project.revision, "name": project.name}
            (out / f"{project.id}.json").write_text(json.dumps(meta, ensure_ascii=False))
            count += 1
    finally:
        await container.aclose()
    return count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "ml" / "data" / "correcciones"))
    args = ap.parse_args()
    n = asyncio.run(export(Path(args.out)))
    print(f"{n} planos corregidos exportados a {args.out}")


if __name__ == "__main__":
    main()
