"""Genera ``truth.json`` de casa3 (lámina CAD oscura con tres plantas) desde la anotación en px.

La lámina mide 720x480 px: los muros son líneas de 1 px y los textos son ilegibles. La
anotación se tomó de la capa blanca (muros) y la azul (puertas y ventanas) separadas por
color, y cubre los muros perimetrales y los tabiques principales; muebles, escalera y
mesones no son muros. Escala por objetos estándar: auto 72 px = 4,5 m, cama 32 px = 2,0 m,
puertas 14 px = 0,85 m → 16 px/m (incierta ±15 %). Cada planta tiene su origen en la
esquina superior izquierda de la casa, en el mismo punto físico (las plantas se dibujan
alineadas por los ejes). Uso: ``python tests/real/casa3/make_truth.py``.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

PX_PER_M = 16.0
Pt = tuple[float, float]
Wall = tuple[Pt, Pt, float, list[tuple[str, float, float]]]

PLANTA_BAJA: list[Wall] = [
    ((45.5, 133), (186, 133), 3, [("window", 60, 84), ("window", 99, 119)]),  # fachada
    ((45.5, 133), (45.5, 298.5), 3, []),
    ((186, 133), (186, 298.5), 3, [("door", 147, 162), ("door", 224, 238)]),  # al pasillo
    ((45.5, 298.5), (186, 298.5), 3, [("door", 67, 85)]),  # acceso desde el garaje
    ((151.5, 133), (151.5, 190.5), 3, []),  # cocina
    ((151.5, 190.5), (186, 190.5), 2, [("door", 172, 186)]),
    ((96.5, 265.5), (96.5, 298.5), 3, [("door", 266, 281)]),  # medio baño
    ((96.5, 265.5), (131.5, 265.5), 3, []),
    ((116.5, 265.5), (116.5, 298.5), 3, []),
]
ROOMS_PB: list[tuple[list[str], list[Pt]]] = [
    (["cocina", "kitchen"], [(153, 135), (184, 135), (184, 189), (153, 189)]),
    (["baño", "bano", "medio baño", "wc"], [(98, 267), (115, 267), (115, 297), (98, 297)]),
    (
        ["sala", "comedor", "estar", "living"],
        [
            (47, 135),
            (150, 135),
            (150, 192),
            (184, 192),
            (184, 297),
            (118, 297),
            (118, 267),
            (95, 267),
            (95, 297),
            (47, 297),
        ],
    ),
]

PLANTA_ALTA: list[Wall] = [
    ((240.5, 133.5), (380.5, 133.5), 3, [("door", 296, 331)]),  # al balcón frontal
    ((240.5, 133.5), (240.5, 323.5), 3, []),
    ((240.5, 323.5), (263, 323.5), 3, [("window", 243, 262)]),
    ((263, 323.5), (263, 355.5), 3, []),
    ((263, 355.5), (380.5, 355.5), 3, [("window", 281, 297), ("window", 334, 355)]),
    ((380.5, 133.5), (380.5, 355.5), 3, []),
    ((295, 133.5), (295, 284), 3, [("door", 161, 175), ("door", 176, 190)]),
    ((240.5, 173.5), (295, 173.5), 2, []),
    ((240.5, 201), (295, 201), 2, []),
    ((240.5, 212), (295, 212), 2, []),
    ((266, 212), (266, 267), 2, []),
    ((240.5, 267), (295, 267), 2, [("door", 251, 264), ("door", 268, 279)]),
    ((295, 190), (380.5, 190), 3, [("door", 331, 344)]),  # recámara principal
    ((330, 190), (330, 241), 3, []),
    ((330, 264.5), (380.5, 264.5), 2, []),
    ((330, 264.5), (330, 299.5), 3, []),
    ((330, 299.5), (380.5, 299.5), 2, [("door", 341, 353), ("door", 354, 367)]),
    ((353, 264.5), (353, 299.5), 2, []),
    ((312.5, 282), (312.5, 355.5), 3, []),
    ((240.5, 285.5), (277, 285.5), 2, []),
]
ROOMS_PA: list[tuple[list[str], list[Pt]]] = [
    (
        ["recamara", "recámara", "dormitorio", "habitacion"],
        [(297, 135), (379, 135), (379, 188), (297, 188)],
    ),
    (["estar", "sala", "family"], [(332, 192), (379, 192), (379, 263), (332, 263)]),
    (
        ["recamara", "recámara", "dormitorio", "habitacion"],
        [(314, 301), (379, 301), (379, 354), (314, 354)],
    ),
    (["baño", "bano"], [(242, 135), (293, 135), (293, 172), (242, 172)]),
]

AZOTEA: list[Wall] = [
    ((496, 119), (583, 119), 3, []),  # antepechos
    ((496, 119), (496, 133.5), 3, []),
    ((442, 133.5), (496, 133.5), 3, []),
    ((442, 133.5), (442, 327), 3, []),
    ((583, 119), (583, 351.5), 3, []),
    ((463, 351.5), (583, 351.5), 3, []),
    ((466.5, 212), (496, 212), 2, []),  # volumen de la escalera
    ((466.5, 266), (496, 266), 2, []),
    ((466.5, 212), (466.5, 266), 2, []),
    ((496, 212), (496, 266), 2, []),
]

LEVELS = [
    ("Planta baja", (45.0, 133.0), PLANTA_BAJA, ROOMS_PB),
    ("Planta alta", (240.0, 133.0), PLANTA_ALTA, ROOMS_PA),
    ("Azotea", (442.0, 133.0), AZOTEA, []),
]


def along(a: Pt, b: Pt, v: float) -> float:
    horizontal = abs(b[0] - a[0]) >= abs(b[1] - a[1])
    return abs(v - (a[0] if horizontal else a[1]))


def main() -> None:
    levels = []
    for name, origin, walls, rooms in LEVELS:

        def m(p: Pt, o: Pt = origin) -> list[float]:
            return [round((p[0] - o[0]) / PX_PER_M, 3), round((p[1] - o[1]) / PX_PER_M, 3)]

        out_walls = []
        for a, b, t, ops in walls:
            length = math.dist(a, b)
            openings = []
            for kind, lo, hi in ops:
                f, g = sorted((along(a, b, lo), along(a, b, hi)))
                assert 0 <= f < g <= length + 1, (name, a, b, lo, hi)
                openings.append(
                    {"kind": kind, "from": round(f / PX_PER_M, 3), "to": round(g / PX_PER_M, 3)}
                )
            out_walls.append(
                {"a": m(a), "b": m(b), "t": round(t / PX_PER_M, 3), "openings": openings}
            )
        levels.append(
            {
                "name": name,
                "origin_px": list(origin),
                "walls": out_walls,
                "rooms": [{"names": n, "polygon": [m(p) for p in poly]} for n, poly in rooms],
            }
        )
    truth = {
        "description": (
            "Casa 3: lámina CAD de fondo oscuro (720x480) con planta baja, planta alta y "
            "azotea, ejes rojos y cajetín. Verdad parcial: muros perimetrales y tabiques "
            "principales, ambientes evidentes. Escala por objetos estándar (16 px/m ±15 %)."
        ),
        "image": "plano.png",
        "px_per_m": PX_PER_M,
        "origin_px": list(LEVELS[0][1]),
        "has_dimensions": False,
        "scale_tolerance": 0.15,
        "levels": levels,
    }
    out = Path(__file__).with_name("truth.json")
    out.write_text(json.dumps(truth, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out}: {len(levels)} niveles")


if __name__ == "__main__":
    main()
