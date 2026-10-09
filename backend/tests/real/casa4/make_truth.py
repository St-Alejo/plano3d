"""Genera ``truth.json`` de casa4: foto de celular (WhatsApp, 900x1600) de la lámina
"PLANTA 2do PISO opc 3", con perspectiva y el papel algo curvado.

La geometría es exacta: sale del modelo levantado a mano desde las cotas de la lámina
(``scripts/modelos/planta_2do_piso_opc3.py``). La foto se relaciona con los metros por una
homografía con las cuatro esquinas exteriores del edificio (medidas sobre la foto ampliada);
la curvatura del papel deja ~5-10 cm de error en el centro, dentro de la tolerancia de 15 cm.

Ambientes: los que cierra la tinta. Cocina, sala-comedor y corredor son un solo espacio
abierto (no hay muro ni puerta entre ellos). El ducto no es un ambiente.
Uso: ``python tests/real/casa4/make_truth.py``.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parents[2] / "src"), str(HERE.parents[2])]

from scripts.modelos.planta_2do_piso_opc3 import ANCHO, LARGO, build_model  # noqa: E402

#: esquinas exteriores del edificio en ``plano.jpg``: sup-izq, sup-der, inf-der, inf-izq
ESQUINAS = ((164.75, 171.25), (733.5, 188.0), (737.0, 1223.25), (201.5, 1246.0))

NOMBRES = {
    "r_punto_fijo": ["punto fijo", "escalera"],
    "r_alcoba3": ["alcoba 3", "alcoba3", "alcoba"],
    "r_bano2": ["baño 2", "baño", "bano"],
    "r_bano1": ["baño 1", "baño", "bano"],
    "r_alcoba2": ["alcoba 2", "alcoba2", "alcoba"],
    "r_alcoba1": ["alcoba 1", "alcoba1", "alcoba"],
}
SOCIAL = ("r_cocina", "r_sala", "r_corredor")


def main() -> None:
    lv = build_model().levels[0]
    h = cv2.getPerspectiveTransform(
        np.array([(0, 0), (ANCHO, 0), (ANCHO, LARGO), (0, LARGO)], np.float32),
        np.array(ESQUINAS, np.float32),
    )
    walls = [
        {
            "a": [w.start.x, w.start.y],
            "b": [w.end.x, w.end.y],
            "t": w.thickness,
            "openings": [
                {"kind": o.kind.value, "from": round(o.offset, 3), "to": round(o.end, 3)}
                for o in w.openings
            ],
        }
        for w in lv.walls
    ]
    rooms = [
        {"names": NOMBRES[r.id], "polygon": [[p.x, p.y] for p in r.polygon]}
        for r in lv.rooms
        if r.id in NOMBRES
    ]
    # espacio social abierto: cocina + sala-comedor + corredor
    rooms.append(
        {
            "names": ["cocina", "sala", "comedor"],
            "polygon": [
                [3.37, 0.12],
                [6.48, 0.12],
                [6.48, 7.40],
                [3.95, 7.40],
                [3.95, 9.60],
                [3.15, 9.60],
                [3.15, 3.24],
                [3.37, 3.24],
            ],
        }
    )
    ppm = math.dist(ESQUINAS[0], ESQUINAS[1]) / ANCHO
    truth = {
        "description": __doc__.splitlines()[0] + " " + __doc__.splitlines()[1].strip(),
        "image": "plano.jpg",
        "px_per_m": round(ppm, 2),
        "origin_px": list(ESQUINAS[0]),
        "homography": [round(float(v), 8) for v in h.ravel()],
        "has_dimensions": True,
        "scale_tolerance": 0.05,
        "levels": [{"name": "2do piso", "walls": walls, "rooms": rooms}],
    }
    (HERE / "truth.json").write_text(
        json.dumps(truth, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"truth.json: {len(walls)} muros, {len(rooms)} ambientes")


if __name__ == "__main__":
    main()
