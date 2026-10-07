"""Genera ``truth.json`` de casa2 a partir de la anotación en píxeles de ``plano.jpg``.

La anotación se tomó de la máscara de tinta negra (tramos medidos) y se revisó superpuesta
al plano. Es un render sin cotas: la escala sale de objetos estándar y no es exacta
(puertas 0,85-1,0 m: ~38-40 px/m; auto de 4,5 m: ~35; camas de 1,6 x 2,0 m: ~45).
Se toma la mediana, 40 px/m, con tolerancia del 15 % porque la propia verdad tiene ese
margen. Uso: ``python tests/real/casa2/make_truth.py``.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

PX_PER_M = 40.0
ORIGIN = (70.0, 464.0)  # esquina superior izquierda (exterior) de la casa

Pt = tuple[float, float]

# (a, b, grosor px, [(tipo, desde_px, hasta_px) medidos sobre el eje del muro])
WALLS: list[tuple[Pt, Pt, float, list[tuple[str, float, float]]]] = [
    # fachada norte, ventanas de las dos recámaras
    ((256, 467.5), (635, 467.5), 7, [("window", 301, 365), ("window", 527, 591)]),
    # recámara 3, muro oeste con tres ventanas pequeñas
    (
        (259.5, 464),
        (259.5, 641),
        7,
        [("window", 490, 514), ("window", 540, 563), ("window", 589, 612)],
    ),
    ((632, 464), (632, 641), 7, [("window", 490, 514)]),  # recámara 2, muro este
    ((446, 464), (446, 583), 8, []),  # entre recámaras (detrás de los clósets)
    ((401, 583), (491, 583), 6, []),  # frente de clósets / vestíbulo
    ((404.5, 583), (404.5, 641), 7, [("door", 586, 626)]),  # puerta recámara 3
    ((487.5, 583), (487.5, 721), 7, [("door", 586, 626)]),  # puerta recámara 2
    # cocina/recámara 3 al norte; vano de 1,9 m sin hoja del vestíbulo al comedor
    ((73, 641.5), (487.5, 641.5), 7, [("door", 104, 145), ("door", 408, 484)]),
    ((487.5, 641), (673.5, 641), 7, []),  # recámara 2 / baño
    # fachada este: dos ventanitas por baño separadas por un montante macizo
    (
        (673.5, 641),
        (673.5, 953),
        8,
        [("window", 655, 671), ("window", 688, 704), ("window", 732, 749), ("window", 765, 782)],
    ),
    ((487.5, 718), (673.5, 718), 6, [("door", 491, 525)]),  # baño / baño master
    ((528.5, 718), (528.5, 795.5), 7, []),
    ((446, 795.5), (673.5, 795.5), 7, [("door", 450, 491), ("door", 597, 628)]),
    ((73, 641), (73, 833), 6, []),  # fachada oeste de la cocina (sigue en el garaje)
    ((73, 795), (259.5, 795), 6, [("window", 108, 171)]),  # cocina / estacionamiento
    (
        (259.5, 795),
        (259.5, 950),
        7,
        [("window", 821, 844), ("window", 864, 888), ("window", 907, 930)],
    ),
    ((259.5, 949.5), (446, 949.5), 7, [("door", 263, 442)]),  # ventanal corredizo al acceso
    ((446, 795.5), (446, 953), 8, []),  # sala / recámara master
    (
        (446, 949.5),
        (673.5, 949.5),
        7,
        [("window", 479, 502), ("window", 525, 562), ("window", 607, 642)],
    ),
    ((601, 838), (601, 949.5), 6, []),  # tabique del vestidor
]

ROOMS: list[tuple[list[str], list[Pt]]] = [
    (
        ["recamara 3", "recámara 3", "recamara", "dormitorio", "habitacion", "alcoba"],
        [(263, 471), (442, 471), (442, 580), (404, 580), (404, 638), (263, 638)],
    ),
    (
        ["recamara 2", "recámara 2", "recamara", "dormitorio", "habitacion", "alcoba"],
        [(450, 471), (629, 471), (629, 638), (488, 638), (488, 580), (450, 580)],
    ),
    (["baño", "bano", "bathroom"], [(491, 645), (670, 645), (670, 715), (491, 715)]),
    (
        ["baño master", "bano master", "baño", "bano"],
        [(532, 721), (670, 721), (670, 792), (532, 792)],
    ),
    (
        ["recamara master", "recámara master", "recamara", "dormitorio", "habitacion"],
        [(450, 799), (670, 799), (670, 946), (450, 946)],
    ),
    (
        ["sala", "comedor", "cocina", "living", "cocina / comedor", "comedor / sala"],
        [
            (76, 645),
            (404, 645),
            (404, 586),
            (484, 586),
            (484, 721),
            (525, 721),
            (525, 792),
            (442, 792),
            (442, 946),
            (263, 946),
            (263, 792),
            (76, 792),
        ],
    ),
]


def m(p: Pt) -> list[float]:
    return [round((p[0] - ORIGIN[0]) / PX_PER_M, 3), round((p[1] - ORIGIN[1]) / PX_PER_M, 3)]


def along(a: Pt, b: Pt, v: float) -> float:
    """Distancia (px) desde ``a`` de la coordenada ``v`` medida en el eje del muro."""
    horizontal = abs(b[0] - a[0]) >= abs(b[1] - a[1])
    return abs(v - (a[0] if horizontal else a[1]))


def main() -> None:
    walls = []
    for a, b, t, ops in WALLS:
        length = math.dist(a, b)
        openings = []
        for kind, lo, hi in ops:
            f, g = sorted((along(a, b, lo), along(a, b, hi)))
            assert 0 <= f < g <= length + 1, (a, b, lo, hi)
            openings.append(
                {"kind": kind, "from": round(f / PX_PER_M, 3), "to": round(g / PX_PER_M, 3)}
            )
        walls.append({"a": m(a), "b": m(b), "t": round(t / PX_PER_M, 3), "openings": openings})
    rooms = [{"names": names, "polygon": [m(p) for p in poly]} for names, poly in ROOMS]
    truth = {
        "description": (
            "Casa 2: render a color de una casa de un piso con foto de fachada arriba, sin "
            "cotas. Verdad trazada en píxeles (make_truth.py); escala por objetos estándar "
            "(~40 px/m, incierta ±15 %). Fuera de la verdad: estacionamiento, acceso "
            "(porche) y área de lavado, que son exteriores."
        ),
        "image": "plano.jpg",
        "px_per_m": PX_PER_M,
        "origin_px": list(ORIGIN),
        "has_dimensions": False,
        "scale_tolerance": 0.15,
        "levels": [{"name": "Planta 1", "walls": walls, "rooms": rooms}],
    }
    out = Path(__file__).with_name("truth.json")
    out.write_text(json.dumps(truth, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out}: {len(walls)} muros, {len(rooms)} ambientes")


if __name__ == "__main__":
    main()
