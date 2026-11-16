"""Casa moderna de 4 pisos (proyecto destacado) en una API que esté corriendo.

    python scripts/demo_casa4.py [http://localhost:8000]

La casa se dibuja aquí en metros, piso por piso. Ancho 12 m, fondo 18 m. La calle queda en
y = 18. El punto fijo (escalera) va en x 5 a 7, y 7 a 11 en todos los pisos.

1. Piso social: garaje doble, hall, estudio, cocina abierta, comedor y una sala de 12 m que
   abre al jardín.
2. Tres alcobas, cada una con baño, más un estar de lectura y la sala familiar.
3. Suite principal con vestier y baño, sala de cine, estudio y alcoba de huéspedes.
4. Azotea: terraza BBQ, gimnasio, sala de juegos, bar y solárium con piscina.

El script crea un proyecto en blanco, guarda el modelo, completa los muebles genéricos y
pone la fachada contemporánea a medida. Lee y escribe en UTF-8.
"""

from __future__ import annotations

import itertools
import math
import sys
from dataclasses import dataclass, field
from typing import Any

import httpx

NAME = "Casa Mirador — 4 pisos"
VIEWER = "http://localhost:5173/p/{id}/3d"
W, D = 12.0, 18.0
EXT, INT = 0.25, 0.12  # grosores de muro exterior e interior


@dataclass
class _Floor:
    name: str
    height: float
    walls: list[dict[str, Any]] = field(default_factory=list)
    rooms: list[dict[str, Any]] = field(default_factory=list)
    stairs: list[dict[str, Any]] = field(default_factory=list)
    columns: list[dict[str, Any]] = field(default_factory=list)
    _n: int = 0

    def _id(self, prefix: str) -> str:
        self._n += 1
        slug = self.name.lower().replace(" ", "")
        return f"{prefix}_{slug}_{self._n}"

    def wall(
        self,
        a: tuple[float, float],
        b: tuple[float, float],
        *openings: tuple[str, float, float, float, float],
        exterior: bool = False,
        height: float | None = None,
        material: str = "plaster",
    ) -> None:
        """``openings``: (tipo, posición del centro medida desde ``a``, ancho, alto, antepecho)."""
        length = math.dist(a, b)
        ops = []
        for kind, at, width, h, sill in openings:
            ops.append(
                {
                    "id": self._id("op"),
                    "kind": kind,
                    "offset": round(at - width / 2, 3),
                    "width": width,
                    "height": h,
                    "sill": sill,
                }
            )
            assert at - width / 2 >= 0 and at + width / 2 <= length, (self.name, a, b, at)
        self.walls.append(
            {
                "id": self._id("w"),
                "start": {"x": a[0], "y": a[1]},
                "end": {"x": b[0], "y": b[1]},
                "thickness": EXT if exterior else INT,
                "height": height if height is not None else self.height,
                "material": material,
                "openings": ops,
                "kind": "exterior" if exterior else "interior",
                "structural": exterior,
            }
        )

    def room(self, label: str, kind: str, x0: float, y0: float, x1: float, y1: float) -> None:
        self.rooms.append(
            {
                "id": self._id("r"),
                "label": label,
                "room_type": kind,
                "polygon": [
                    {"x": x0, "y": y0},
                    {"x": x1, "y": y0},
                    {"x": x1, "y": y1},
                    {"x": x0, "y": y1},
                ],
            }
        )

    def stair_up(self) -> None:
        steps = 17
        self.stairs.append(
            {
                "id": self._id("s"),
                "start": {"x": 6.0, "y": 10.8},
                "end": {"x": 6.0, "y": 7.2},
                "width": 1.1,
                "steps": steps,
                "riser": round(self.height / steps, 4),
            }
        )

    def frame(self) -> None:
        """Columnas del pórtico (las mismas en todos los pisos, alinean el apilado)."""
        for x in (0.0, 5.0, 7.0, 12.0):
            for y in (0.0, 7.0, 11.0, 18.0):
                self.columns.append(
                    {"id": self._id("c"), "center": {"x": x, "y": y}, "width": 0.35, "depth": 0.35}
                )


DOOR, WIN = "door", "window"


def _piso1() -> _Floor:
    f = _Floor("Piso 1", 3.0)
    # fachada posterior al jardín: ventanales de piso a techo y puerta-ventana
    f.wall(
        (0, 0),
        (W, 0),
        (WIN, 2.6, 3.6, 2.6, 0.1),
        (DOOR, 6.0, 1.8, 2.6, 0),
        (WIN, 9.4, 3.6, 2.6, 0.1),
        exterior=True,
    )
    f.wall(
        (W, 0),
        (W, D),
        (WIN, 3.5, 2.4, 2.2, 0.4),
        (WIN, 9.0, 2.0, 1.6, 0.9),
        (WIN, 12.5, 0.8, 0.6, 1.5),
        (WIN, 16.0, 2.0, 1.5, 0.9),
        exterior=True,
    )
    f.wall(
        (W, D),
        (0, D),
        (WIN, 2.5, 2.6, 1.5, 0.9),
        (DOOR, 6.0, 1.3, 2.6, 0),
        (DOOR, 9.5, 4.0, 2.5, 0),
        exterior=True,
    )
    f.wall((0, D), (0, 0), (WIN, 8.5, 1.8, 1.1, 1.0), (WIN, 15.5, 2.5, 2.4, 0.2), exterior=True)
    # interiores
    f.wall((0, 7), (5, 7), (DOOR, 2.5, 3.0, 2.6, 0))  # cocina abierta a la sala (vano)
    f.wall((5, 7), (5, 11))
    f.wall((7, 7), (7, 11), (DOOR, 2.0, 2.4, 2.6, 0))  # comedor ↔ punto fijo (vano)
    f.wall((0, 12), (5, 12), (DOOR, 1.0, 0.9, 2.1, 0))  # cocina ↔ estudio
    f.wall((5, 11), (5, D), (DOOR, 3.0, 1.0, 2.1, 0))  # hall ↔ estudio
    f.wall(
        (7, 11), (7, D), (DOOR, 1.5, 0.8, 2.1, 0), (DOOR, 5.0, 1.0, 2.1, 0)
    )  # hall ↔ baño, garaje
    f.wall((7, 11), (W, 11), (DOOR, 3.75, 0.8, 2.1, 0))  # comedor ↔ ropas
    f.wall((9.5, 11), (9.5, 14))
    f.wall((7, 14), (W, 14))
    f.room("Sala", "living", 0, 0, W, 7)
    f.room("Cocina", "kitchen", 0, 7, 5, 12)
    f.room("Estudio", "study", 0, 12, 5, D)
    f.room("Punto fijo", "stairs", 5, 7, 7, 11)
    f.room("Hall de acceso", "circulation", 5, 11, 7, D)
    f.room("Comedor", "living", 7, 7, W, 11)
    f.room("Baño social", "bathroom", 7, 11, 9.5, 14)
    f.room("Ropas", "laundry", 9.5, 11, W, 14)
    f.room("Garaje", "garage", 7, 14, W, D)
    f.stair_up()
    f.frame()
    return f


def _piso2() -> _Floor:
    f = _Floor("Piso 2", 3.0)
    f.wall((0, 0), (W, 0), (WIN, 2.5, 3.0, 2.2, 0.4), (WIN, 8.5, 4.0, 2.4, 0.2), exterior=True)
    f.wall(
        (W, 0),
        (W, D),
        (WIN, 3.5, 2.0, 1.6, 0.9),
        (WIN, 9.0, 2.0, 1.4, 1.0),
        (WIN, 16.0, 2.4, 1.6, 0.9),
        exterior=True,
    )
    f.wall(
        (W, D),
        (0, D),
        (WIN, 2.5, 3.0, 2.4, 0.2),
        (WIN, 6.0, 1.2, 1.2, 1.0),
        (WIN, 9.5, 3.0, 2.4, 0.2),
        exterior=True,
    )
    f.wall(
        (0, D),
        (0, 0),
        (WIN, 7.25, 0.8, 0.6, 1.5),
        (WIN, 9.75, 0.8, 0.6, 1.5),
        (WIN, 15.0, 2.0, 1.6, 0.9),
        exterior=True,
    )
    f.wall((0, 7), (5, 7), (DOOR, 4.2, 0.9, 2.1, 0))  # alcoba 3 ↔ baño 3
    f.wall((5, 0), (5, 7), (DOOR, 6.0, 0.9, 2.1, 0))  # alcoba 3 ↔ sala familiar
    f.wall((0, 9.5), (5, 9.5))
    f.wall((0, 12), (5, 12), (DOOR, 4.2, 0.9, 2.1, 0))  # alcoba 1 ↔ baño 1
    f.wall((5, 7), (5, 11))
    f.wall((5, 11), (5, D), (DOOR, 2.0, 0.9, 2.1, 0))  # hall ↔ alcoba 1
    f.wall((7, 7), (7, 11), (DOOR, 2.0, 2.0, 2.6, 0))  # estar de lectura (vano)
    f.wall((7, 11), (7, D), (DOOR, 4.5, 0.9, 2.1, 0))  # hall ↔ alcoba 2
    f.wall((7, 14), (W, 14), (DOOR, 1.25, 0.8, 2.1, 0), (DOOR, 3.75, 0.8, 2.1, 0))
    f.wall((9.5, 11), (9.5, 14))
    f.wall((7, 11), (W, 11))
    f.wall((5, 7), (7, 7))
    f.room("Alcoba 3", "bedroom", 0, 0, 5, 7)
    f.room("Sala familiar", "living", 5, 0, W, 7)
    f.room("Baño alcoba 3", "bathroom", 0, 7, 5, 9.5)
    f.room("Baño alcoba 1", "bathroom", 0, 9.5, 5, 12)
    f.room("Alcoba 1", "bedroom", 0, 12, 5, D)
    f.room("Punto fijo", "stairs", 5, 7, 7, 11)
    f.room("Hall", "circulation", 5, 11, 7, D)
    f.room("Estar de lectura", "study", 7, 7, W, 11)
    f.room("Baño alcoba 2", "bathroom", 7, 11, 9.5, 14)
    f.room("Vestier alcoba 2", "storage", 9.5, 11, W, 14)
    f.room("Alcoba 2", "bedroom", 7, 14, W, D)
    f.stair_up()
    f.frame()
    return f


def _piso3() -> _Floor:
    f = _Floor("Piso 3", 3.0)
    f.wall((0, 0), (W, 0), (WIN, 3.5, 5.0, 2.6, 0.1), (WIN, 9.5, 2.0, 0.8, 1.6), exterior=True)
    f.wall(
        (W, 0),
        (W, D),
        (WIN, 2.0, 1.2, 0.8, 1.6),
        (WIN, 9.0, 2.4, 1.6, 0.9),
        (WIN, 16.0, 2.4, 1.6, 0.9),
        exterior=True,
    )
    f.wall((W, D), (0, D), (WIN, 2.5, 3.0, 2.4, 0.2), (WIN, 9.5, 3.0, 2.4, 0.2), exterior=True)
    f.wall((0, D), (0, 0), (WIN, 9.0, 2.5, 1.6, 0.9), (WIN, 15.0, 2.5, 1.6, 0.9), exterior=True)
    f.wall(
        (7, 0), (7, 7), (DOOR, 2.0, 0.9, 2.1, 0), (DOOR, 5.5, 1.2, 2.4, 0)
    )  # suite ↔ baño, vestier
    f.wall((7, 4), (W, 4), (DOOR, 2.5, 0.8, 2.1, 0))  # vestier ↔ baño
    f.wall((0, 7), (5, 7), (DOOR, 4.0, 1.0, 2.1, 0))  # suite ↔ sala de cine
    f.wall((5, 7), (7, 7), (DOOR, 1.0, 1.0, 2.1, 0))  # suite ↔ punto fijo
    f.wall((7, 7), (W, 7))
    f.wall((5, 7), (5, 11))
    f.wall((5, 11), (5, D), (DOOR, 1.5, 1.6, 2.4, 0))  # hall ↔ sala de cine
    f.wall((7, 7), (7, 11), (DOOR, 2.0, 0.9, 2.1, 0))
    f.wall((7, 11), (7, D), (DOOR, 1.0, 0.8, 2.1, 0), (DOOR, 3.5, 0.9, 2.1, 0))
    f.wall((7, 11), (W, 11))
    f.wall((7, 13), (W, 13), (DOOR, 4.0, 0.8, 2.1, 0))
    f.room("Suite principal", "bedroom", 0, 0, 7, 7)
    f.room("Baño suite", "bathroom", 7, 0, W, 4)
    f.room("Vestier", "storage", 7, 4, W, 7)
    f.room("Sala de cine", "living", 0, 7, 5, D)
    f.room("Punto fijo", "stairs", 5, 7, 7, 11)
    f.room("Hall", "circulation", 5, 11, 7, D)
    f.room("Estudio principal", "study", 7, 7, W, 11)
    f.room("Baño huéspedes", "bathroom", 7, 11, W, 13)
    f.room("Alcoba de huéspedes", "bedroom", 7, 13, W, D)
    f.stair_up()
    f.frame()
    return f


def _piso4() -> _Floor:
    f = _Floor("Azotea", 3.2)
    parapet = 1.1
    # terraza posterior y solárium: muros bajos (antepechos de vidrio y concreto)
    f.wall((0, 0), (W, 0), exterior=True, height=parapet, material="concreto")
    f.wall((W, 0), (W, 7), exterior=True, height=parapet, material="concreto")
    f.wall((W, 7), (W, 14), (WIN, 3.5, 4.0, 2.2, 0.4), exterior=True)
    f.wall((W, 14), (W, D), exterior=True, height=parapet, material="concreto")
    f.wall((W, D), (0, D), exterior=True, height=parapet, material="concreto")
    f.wall((0, D), (0, 14), exterior=True, height=parapet, material="concreto")
    f.wall((0, 14), (0, 7), (WIN, 4.5, 3.0, 2.2, 0.4), exterior=True)
    f.wall((0, 7), (0, 0), exterior=True, height=parapet, material="concreto")
    # bloque cubierto: gimnasio, punto fijo, juegos, baño y bar
    f.wall((0, 7), (5, 7), (WIN, 2.5, 3.6, 2.4, 0.2))  # gimnasio → terraza
    f.wall((5, 7), (7, 7), (DOOR, 1.0, 1.6, 2.4, 0))  # punto fijo → terraza
    f.wall((7, 7), (W, 7), (DOOR, 2.5, 3.6, 2.6, 0))  # juegos → terraza (corrediza)
    f.wall((5, 7), (5, 11))
    f.wall((5, 11), (5, 14), (DOOR, 1.5, 1.0, 2.1, 0))  # hall ↔ gimnasio
    f.wall((7, 7), (7, 11))
    f.wall((7, 11), (7, 14), (DOOR, 0.5, 0.8, 2.1, 0))
    f.wall((7, 12), (W, 12), (DOOR, 3.5, 1.2, 2.1, 0))
    f.wall((9.5, 12), (9.5, 14))
    f.wall(
        (0, 14),
        (W, 14),
        (WIN, 2.5, 3.0, 1.0, 1.1),
        (DOOR, 6.0, 1.6, 2.4, 0),
        (WIN, 10.75, 2.0, 1.0, 1.1),
    )
    f.room("Terraza BBQ", "patio", 0, 0, W, 7)
    f.room("Gimnasio", "other", 0, 7, 5, 14)
    f.room("Punto fijo", "stairs", 5, 7, 7, 11)
    f.room("Hall", "circulation", 5, 11, 7, 14)
    f.room("Sala de juegos", "living", 7, 7, W, 12)
    f.room("Baño azotea", "bathroom", 7, 12, 9.5, 14)
    f.room("Bar", "kitchen", 9.5, 12, W, 14)
    f.room("Solárium y piscina", "patio", 0, 14, W, D)
    f.frame()
    return f


FACADE_CUSTOM: dict[str, Any] = {
    "ground": {"material": "concreto", "color": "#b9b5ad"},
    "upper": {"material": "panete", "color": "#f2efe8"},
    "front": {"material": "madera", "color": "#8a5a3b"},
    "gate": {"material": "madera", "color": "#5b3a26"},
    "frame": "#1f1f1f",
    "band": "#2b2b2b",
    "accent": "#c79a5b",
    "features": ["listones", "jardinera", "marco_ventana", "alero", "luces"],
}


def build_levels() -> list[dict[str, Any]]:
    """Los cuatro pisos como ``LevelDTO`` (ids estables y escaleras enlazadas)."""
    floors = [_piso1(), _piso2(), _piso3(), _piso4()]
    levels: list[dict[str, Any]] = []
    elevation = 0.0
    for i, f in enumerate(floors):
        levels.append(
            {
                "id": f"lvl_casa4_{i + 1}",
                "name": f.name,
                "elevation": round(elevation, 3),
                "height": f.height,
                "walls": f.walls,
                "rooms": f.rooms,
                "columns": f.columns,
                "stairs": f.stairs,
                "dimensions": [],
                "labels": [],
                "furniture": [],
            }
        )
        elevation += f.height
    for lower, upper in itertools.pairwise(levels):
        for s in lower["stairs"]:
            s["to_level_id"] = upper["id"]
    return levels


def _ok(r: httpx.Response) -> dict[str, Any]:
    if r.status_code >= 400:
        raise SystemExit(f"{r.request.method} {r.request.url} → {r.status_code}: {r.text[:600]}")
    data: dict[str, Any] = r.json()
    return data


def _if_match(p: dict[str, Any]) -> dict[str, str]:
    return {"If-Match": f'"{p["revision"]}"'}


def main(base: str, client: httpx.Client | None = None) -> str:
    """Devuelve el id del proyecto. ``client``: uno ya abierto (p. ej. un TestClient)."""
    with client or httpx.Client(base_url=base, timeout=120) as c:
        p = _ok(c.post("/api/projects/blank", json={"name": NAME}))
        pid = p["id"]
        model = dict(p["model"])
        model["levels"] = build_levels()
        p = _ok(
            c.put(
                f"/api/projects/{pid}/model",
                params={"summary": "Casa Mirador de 4 pisos"},
                json=model,
                headers=_if_match(p),
            )
        )
        for lv in p["model"]["levels"]:
            p = _ok(
                c.post(
                    f"/api/projects/{pid}/furnish",
                    json={"level_id": lv["id"]},
                    headers=_if_match(p),
                )
            )
        p = _ok(
            c.put(
                f"/api/projects/{pid}/facade",
                json={"style": "moderna_contemporanea", "custom": FACADE_CUSTOM},
                headers=_if_match(p),
            )
        )
        for lv in p["model"]["levels"]:
            print(
                f"{lv['name']}: elevación {lv['elevation']:.2f} m, "
                f"{len(lv['rooms'])} ambientes, {len(lv.get('furniture') or [])} muebles"
            )
        print(f"área total {p['model'].get('total_area', 0):.0f} m², revisión {p['revision']}")
        print(VIEWER.format(id=pid))
        return str(pid)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000")
