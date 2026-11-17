"""Proyectos de ejemplo de la cuenta demo: apartamentos, casa campestre, local y dúplex.

    python scripts/demo_ejemplos.py [http://localhost:8000]

Cada ejemplo se describe como una distribución de ambientes rectangulares en metros (como en
``demo_casa4.py``, sin plano subido). Los muros salen de la distribución:

- el contorno de cada piso es muro exterior, con una ventana por ambiente y por lado;
- donde dos ambientes comparten un lado va un muro interior, con puerta si el par está en la
  lista de puertas (o un vano ancho si es un ambiente abierto, como cocina y sala);
- la entrada es una puerta en la fachada de la calle (y = fondo) del ambiente que se indique.

Luego se completan los muebles y se pone la fachada. ``make_demo_fixture.py ejemplos`` corre
esto en memoria y guarda cada uno con su id fijo en ``infrastructure/demo/data``.
"""

from __future__ import annotations

import itertools
import math
import sys
from dataclasses import dataclass, field
from typing import Any

import httpx

EXT, INT = 0.25, 0.12

#: (x0, y0, x1, y1)
Rect = tuple[float, float, float, float]


@dataclass(frozen=True)
class Space:
    key: str
    label: str
    kind: str
    rect: Rect
    #: lados exteriores sin ventana ("n" y=0, "s" y=fondo, "w" x=0, "e" x=ancho)
    blind: str = ""


@dataclass
class Floor:
    name: str
    spaces: list[Space]
    #: pares con puerta; ("a", "b", "open") deja un vano ancho
    doors: list[tuple[str, ...]] = field(default_factory=list)
    entry: str | None = None
    height: float = 2.6
    #: escalera al piso de arriba: (x, y inicio, y fin)
    stair: tuple[float, float, float] | None = None


@dataclass
class Example:
    id: str
    name: str
    facade: str
    floors: list[Floor]


def _shared(a: Rect, b: Rect) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """Lado común de dos rectángulos que se tocan (o None si no comparten más de 0,6 m)."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    for x in {ax1} & {bx0} | {ax0} & {bx1}:  # se tocan por un lado vertical
        lo, hi = max(ay0, by0), min(ay1, by1)
        if hi - lo > 0.6:
            return (x, lo), (x, hi)
    for y in {ay1} & {by0} | {ay0} & {by1}:  # por un lado horizontal
        lo, hi = max(ax0, bx0), min(ax1, bx1)
        if hi - lo > 0.6:
            return (lo, y), (hi, y)
    return None


def _opening(
    kind: str, at: float, width: float, height: float, sill: float, ident: str
) -> dict[str, Any]:
    return {
        "id": ident,
        "kind": kind,
        "offset": round(at - width / 2, 3),
        "width": width,
        "height": height,
        "sill": sill,
    }


def build_level(ex: Example, i: int, f: Floor, elevation: float) -> dict[str, Any]:
    tag = f"{ex.id.removeprefix('prj_')}_{i + 1}"
    counter = itertools.count(1)
    width = max(s.rect[2] for s in f.spaces)
    depth = max(s.rect[3] for s in f.spaces)
    walls: list[dict[str, Any]] = []

    def wall(
        a: tuple[float, float],
        b: tuple[float, float],
        openings: list[dict[str, Any]],
        exterior: bool,
    ) -> None:
        walls.append(
            {
                "id": f"w_{tag}_{next(counter)}",
                "start": {"x": a[0], "y": a[1]},
                "end": {"x": b[0], "y": b[1]},
                "thickness": EXT if exterior else INT,
                "height": f.height,
                "material": "plaster",
                "openings": openings,
                "kind": "exterior" if exterior else "interior",
                "structural": exterior,
            }
        )

    # contorno: un tramo por ambiente y por lado exterior (así cada uno lleva su ventana)
    for s in f.spaces:
        x0, y0, x1, y1 = s.rect
        sides = {
            "n": ((x0, 0.0), (x1, 0.0), y0 == 0),
            "e": ((width, y0), (width, y1), x1 == width),
            "s": ((x1, depth), (x0, depth), y1 == depth),
            "w": ((0.0, y1), (0.0, y0), x0 == 0),
        }
        for side, (a, b, outside) in sides.items():
            if not outside:
                continue
            length = math.dist(a, b)
            ops: list[dict[str, Any]] = []
            n = f"op_{tag}_{next(counter)}"
            if side == "s" and f.entry == s.key:
                ops.append(_opening("door", min(1.2, length / 2), 1.0, 2.2, 0, n))
                if length >= 4.4:  # la puerta ocupa 0,7 a 1,7 m; la ventana, el otro extremo
                    ops.append(
                        _opening("window", length - 1.4, 1.6, 1.4, 0.9, f"op_{tag}_{next(counter)}")
                    )
            elif (
                side not in s.blind
                and length >= 1.6
                and s.kind not in ("stairs", "circulation", "storage")
            ):
                small = s.kind == "bathroom"
                width = 0.6 if small else min(2.4, round(length * 0.45, 1))
                ops.append(
                    _opening(
                        "window", length / 2, width, 0.6 if small else 1.4, 1.5 if small else 0.9, n
                    )
                )
            wall(a, b, ops, exterior=True)

    # interiores: un muro por par de ambientes que se tocan
    doors = {frozenset(d[:2]): (d[2] if len(d) > 2 else "door") for d in f.doors}
    for s, t in itertools.combinations(f.spaces, 2):
        seg = _shared(s.rect, t.rect)
        if seg is None:
            continue
        a, b = seg
        length = math.dist(a, b)
        how = doors.get(frozenset((s.key, t.key)))
        ops = []
        if how == "open":
            width = round(min(length - 0.4, 3.0), 2)
            ops.append(_opening("door", length / 2, width, 2.3, 0, f"op_{tag}_{next(counter)}"))
        elif how == "door":
            ops.append(
                _opening("door", min(0.7, length / 2), 0.9, 2.1, 0, f"op_{tag}_{next(counter)}")
            )
        wall(a, b, ops, exterior=False)

    rooms = [
        {
            "id": f"r_{tag}_{s.key}",
            "label": s.label,
            "room_type": s.kind,
            "polygon": [
                {"x": s.rect[0], "y": s.rect[1]},
                {"x": s.rect[2], "y": s.rect[1]},
                {"x": s.rect[2], "y": s.rect[3]},
                {"x": s.rect[0], "y": s.rect[3]},
            ],
        }
        for s in f.spaces
    ]
    stairs = []
    if f.stair:
        x, ya, yb = f.stair
        steps = 15
        stairs.append(
            {
                "id": f"s_{tag}",
                "start": {"x": x, "y": ya},
                "end": {"x": x, "y": yb},
                "width": 0.95,
                "steps": steps,
                "riser": round(f.height / steps, 4),
            }
        )
    return {
        "id": f"lvl_{tag}",
        "name": f.name,
        "elevation": round(elevation, 3),
        "height": f.height,
        "walls": walls,
        "rooms": rooms,
        "columns": [],
        "stairs": stairs,
        "dimensions": [],
        "labels": [],
        "furniture": [],
    }


def build_levels(ex: Example) -> list[dict[str, Any]]:
    levels, elevation = [], 0.0
    for i, f in enumerate(ex.floors):
        levels.append(build_level(ex, i, f, elevation))
        elevation += f.height
    for lower, upper in itertools.pairwise(levels):
        for s in lower["stairs"]:
            s["to_level_id"] = upper["id"]
    return levels


S = Space
EXAMPLES: list[Example] = [
    Example(
        "prj_ej_apto1",
        "Apartaestudio de 1 alcoba",
        "moderna_blanca",
        [
            Floor(
                "Piso 1",
                [
                    S("sala", "Sala-comedor", "living", (0, 0, 5.5, 4.5)),
                    S("alcoba", "Alcoba", "bedroom", (5.5, 0, 9, 4.5)),
                    S("cocina", "Cocina", "kitchen", (0, 4.5, 3, 7)),
                    S("hall", "Hall", "circulation", (3, 4.5, 5.5, 7)),
                    S("bano", "Baño", "bathroom", (5.5, 4.5, 7.5, 7)),
                    S("ropas", "Ropas", "laundry", (7.5, 4.5, 9, 7)),
                ],
                doors=[
                    ("sala", "cocina", "open"),
                    ("sala", "hall", "open"),
                    ("sala", "alcoba"),
                    ("hall", "bano"),
                    ("cocina", "hall"),
                    ("bano", "ropas"),
                ],
                entry="hall",
            )
        ],
    ),
    Example(
        "prj_ej_apto2",
        "Apartamento de 2 alcobas",
        "moderna_blanca",
        [
            Floor(
                "Piso 1",
                [
                    S("sala", "Sala", "living", (0, 0, 6, 5)),
                    S("comedor", "Comedor", "living", (6, 0, 9, 5)),
                    S("alcoba1", "Alcoba principal", "bedroom", (9, 0, 13, 5)),
                    S("cocina", "Cocina", "kitchen", (0, 5, 3.5, 8.5)),
                    S("hall", "Hall", "circulation", (3.5, 5, 9, 6.5)),
                    S("bano1", "Baño", "bathroom", (3.5, 6.5, 6, 8.5)),
                    S("alcoba2", "Alcoba 2", "bedroom", (6, 6.5, 9, 8.5)),
                    S("bano2", "Baño principal", "bathroom", (9, 5, 11, 8.5)),
                    S("estudio", "Estudio", "study", (11, 5, 13, 8.5)),
                ],
                doors=[
                    ("sala", "comedor", "open"),
                    ("sala", "cocina", "open"),
                    ("sala", "hall", "open"),
                    ("comedor", "hall", "open"),
                    ("hall", "bano1"),
                    ("hall", "alcoba2"),
                    ("comedor", "alcoba1"),
                    ("alcoba1", "bano2"),
                    ("alcoba1", "estudio"),
                ],
                entry="cocina",
            )
        ],
    ),
    Example(
        "prj_ej_apto3",
        "Apartamento familiar de 3 alcobas",
        "moderna_ladrillo",
        [
            Floor(
                "Piso 1",
                [
                    S("sala", "Sala", "living", (0, 0, 7, 5.5)),
                    S("comedor", "Comedor", "living", (7, 0, 11, 5.5)),
                    S("alcoba1", "Alcoba principal", "bedroom", (11, 0, 15, 5.5)),
                    S("cocina", "Cocina", "kitchen", (0, 5.5, 4, 9.5)),
                    S("ropas", "Ropas", "laundry", (0, 9.5, 4, 11)),
                    S("hall", "Corredor", "circulation", (4, 5.5, 15, 7)),
                    S("alcoba2", "Alcoba 2", "bedroom", (4, 7, 7.5, 11)),
                    S("bano1", "Baño social", "bathroom", (7.5, 7, 9.5, 11)),
                    S("alcoba3", "Alcoba 3", "bedroom", (9.5, 7, 13, 11)),
                    S("bano2", "Baño principal", "bathroom", (13, 7, 15, 11)),
                ],
                doors=[
                    ("sala", "comedor", "open"),
                    ("sala", "cocina", "open"),
                    ("sala", "hall", "open"),
                    ("comedor", "hall", "open"),
                    ("cocina", "ropas"),
                    ("hall", "alcoba2"),
                    ("hall", "bano1"),
                    ("hall", "alcoba3"),
                    ("hall", "alcoba1"),
                    ("hall", "bano2"),
                ],
                entry="ropas",
            )
        ],
    ),
    Example(
        "prj_ej_campestre",
        "Casa campestre de una planta",
        "moderna_madera",
        [
            Floor(
                "Piso 1",
                [
                    S("terraza", "Terraza", "patio", (0, 0, 16, 3)),
                    S("sala", "Sala con chimenea", "living", (0, 3, 7, 9)),
                    S("comedor", "Comedor", "living", (7, 3, 11, 9)),
                    S("cocina", "Cocina", "kitchen", (11, 3, 16, 7)),
                    S("despensa", "Despensa", "storage", (11, 7, 13, 9)),
                    S("ropas", "Ropas", "laundry", (13, 7, 16, 9)),
                    S("alcoba1", "Alcoba principal", "bedroom", (0, 9, 5, 14)),
                    S("bano1", "Baño principal", "bathroom", (5, 9, 7, 14)),
                    S("hall", "Hall", "circulation", (7, 9, 9, 14)),
                    S("alcoba2", "Alcoba de huéspedes", "bedroom", (9, 9, 13, 14)),
                    S("bano2", "Baño", "bathroom", (13, 9, 16, 11.5)),
                    S("estudio", "Estudio", "study", (13, 11.5, 16, 14)),
                ],
                doors=[
                    ("terraza", "sala", "open"),
                    ("terraza", "comedor"),
                    ("sala", "comedor", "open"),
                    ("comedor", "cocina", "open"),
                    ("cocina", "despensa"),
                    ("cocina", "ropas"),
                    ("comedor", "hall", "open"),
                    ("hall", "alcoba1"),
                    ("alcoba1", "bano1"),
                    ("hall", "alcoba2"),
                    ("alcoba2", "bano2"),
                    ("alcoba2", "estudio"),
                ],
                entry="hall",
            )
        ],
    ),
    Example(
        "prj_ej_local",
        "Local comercial con oficina",
        "moderna_contemporanea",
        [
            Floor(
                "Piso 1",
                [
                    S("salon", "Salón de ventas", "other", (0, 0, 10, 7)),
                    S("oficina", "Oficina", "study", (0, 7, 4, 10)),
                    S("bodega", "Bodega", "storage", (4, 7, 8, 10)),
                    S("bano", "Baño", "bathroom", (8, 7, 10, 10)),
                ],
                doors=[("salon", "oficina"), ("salon", "bodega"), ("salon", "bano")],
                entry="salon",
                height=3.2,
            )
        ],
    ),
    Example(
        "prj_ej_duplex",
        "Dúplex de dos pisos",
        "moderna_contemporanea",
        [
            Floor(
                "Piso 1",
                [
                    S("sala", "Sala-comedor", "living", (0, 0, 7, 5)),
                    S("cocina", "Cocina", "kitchen", (7, 0, 10, 5)),
                    S("escalera", "Escalera", "stairs", (0, 5, 2.5, 9)),
                    S("hall", "Hall", "circulation", (2.5, 5, 7, 9)),
                    S("bano", "Baño social", "bathroom", (7, 5, 10, 9)),
                ],
                doors=[
                    ("sala", "cocina", "open"),
                    ("sala", "hall", "open"),
                    ("hall", "escalera", "open"),
                    ("hall", "bano"),
                ],
                entry="hall",
                stair=(1.25, 8.6, 5.4),
            ),
            Floor(
                "Piso 2",
                [
                    S("alcoba1", "Alcoba principal", "bedroom", (0, 0, 5, 5)),
                    S("estudio", "Estudio", "study", (5, 0, 10, 5)),
                    S("escalera", "Escalera", "stairs", (0, 5, 2.5, 9)),
                    S("hall", "Hall", "circulation", (2.5, 5, 10, 6.5)),
                    S("bano", "Baño", "bathroom", (2.5, 6.5, 5.5, 9)),
                    S("alcoba2", "Alcoba 2", "bedroom", (5.5, 6.5, 10, 9)),
                ],
                doors=[
                    ("hall", "escalera", "open"),
                    ("hall", "alcoba1"),
                    ("hall", "estudio"),
                    ("hall", "bano"),
                    ("hall", "alcoba2"),
                ],
            ),
        ],
    ),
]


def _ok(r: httpx.Response) -> dict[str, Any]:
    if r.status_code >= 400:
        raise SystemExit(f"{r.request.method} {r.request.url} → {r.status_code}: {r.text[:600]}")
    data: dict[str, Any] = r.json()
    return data


def _if_match(p: dict[str, Any]) -> dict[str, str]:
    return {"If-Match": f'"{p["revision"]}"'}


def create(ex: Example, c: httpx.Client) -> str:
    p = _ok(c.post("/api/projects/blank", json={"name": ex.name}))
    pid = p["id"]
    model = dict(p["model"])
    model["levels"] = build_levels(ex)
    p = _ok(
        c.put(
            f"/api/projects/{pid}/model",
            params={"summary": ex.name},
            json=model,
            headers=_if_match(p),
        )
    )
    for lv in p["model"]["levels"]:
        p = _ok(
            c.post(
                f"/api/projects/{pid}/furnish", json={"level_id": lv["id"]}, headers=_if_match(p)
            )
        )
    p = _ok(c.put(f"/api/projects/{pid}/facade", json={"style": ex.facade}, headers=_if_match(p)))
    rooms = sum(len(lv["rooms"]) for lv in p["model"]["levels"])
    furniture = sum(len(lv.get("furniture") or []) for lv in p["model"]["levels"])
    print(f"{ex.name}: {len(p['model']['levels'])} pisos, {rooms} ambientes, {furniture} muebles")
    return str(pid)


def main(base: str, client: httpx.Client | None = None) -> dict[str, str]:
    """Crea los ejemplos; devuelve id fijo → id creado."""
    with client or httpx.Client(base_url=base, timeout=120) as c:
        return {ex.id: create(ex, c) for ex in EXAMPLES}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000")
