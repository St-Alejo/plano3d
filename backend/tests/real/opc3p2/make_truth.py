"""Genera ``truth.json`` de opc3p2: el PDF vectorial (CAD, 1:50) de la lámina "PLANTA 2do
PISO opc 3", la misma que fotografían casa4 y casa4hd.

La geometría sale del modelo levantado a mano desde las cotas
(``scripts/modelos/planta_2do_piso_opc3.py``). En metros, con origen en la esquina exterior
superior izquierda; ``eval_real`` lleva ahí la del modelo detectado.

Ambientes: cocina y sala-comedor son un solo espacio (no hay muro ni puerta entre ellos).
El corredor de los baños queda aparte: lo cierra el paso bajo la viga del eje 2.
Uso: ``python tests/real/opc3p2/make_truth.py``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parents[2] / "src"), str(HERE.parents[2])]

from scripts.modelos.planta_2do_piso_opc3 import build_model  # noqa: E402

NOMBRES = {
    "r_punto_fijo": ["escalera", "punto fijo"],
    "r_alcoba3": ["alcoba 3"],
    "r_bano2": ["baño 2", "baño"],
    "r_bano1": ["baño 1", "baño"],
    "r_alcoba2": ["alcoba 2"],
    "r_alcoba1": ["alcoba 1"],
    "r_corredor": ["pasillo", "corredor"],
}


def main() -> None:
    lv = build_model().levels[0]
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
    rooms.append(
        {
            "names": ["sala-comedor / cocina", "cocina", "sala"],
            "polygon": [
                [3.37, 0.12],
                [6.48, 0.12],
                [6.48, 7.40],
                [3.15, 7.40],
                [3.15, 3.24],
                [3.37, 3.24],
            ],
        }
    )
    doc = (__doc__ or "").splitlines()
    truth = {
        "description": doc[0] + " " + doc[1].strip(),
        "image": "plano.pdf",
        "has_dimensions": True,
        "scale_tolerance": 0.02,
        "levels": [{"name": "2do piso", "walls": walls, "rooms": rooms}],
    }
    (HERE / "truth.json").write_text(
        json.dumps(truth, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"truth.json: {len(walls)} muros, {len(rooms)} ambientes")


if __name__ == "__main__":
    main()
