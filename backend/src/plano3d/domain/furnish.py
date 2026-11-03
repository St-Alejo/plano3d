"""Amoblar un piso: completar lo que falta según el tipo de cada ambiente.

Lo dibujado en el plano (``infrastructure/vector/furniture.py``) se respeta tal cual; aquí
solo se agrega lo que falta de cada grupo (una alcoba que ya tiene cama no lleva otra). Los
muebles de muro van contra el lado más largo que los reciba, centrados, sin salirse del
ambiente, sin montarse en otro mueble y fuera del barrido de las puertas; los altos
(closet, nevera) además dejan libres las ventanas. El comedor va suelto, lo más cerca del
centro que quede libre.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from plano3d.domain.building import Level, OpeningKind, Room
from plano3d.domain.elements import Furniture, RoomType
from plano3d.domain.geometry import Point2D

#: separación del mueble a la cara del muro (m)
GAP = 0.02
#: holgura libre alrededor de un mueble suelto (sillas que se corren, paso)
FREE_CLEARANCE = 0.5
#: paso de búsqueda a lo largo de un lado y en la grilla de los sueltos (m)
STEP = 0.1


@dataclass(frozen=True)
class _Piece:
    catalog_id: str
    width: float
    depth: float
    height: float
    #: grupo: si el ambiente ya tiene un mueble del grupo, no se agrega
    group: str
    wall: bool = True


_BED_DOUBLE = _Piece("cama_doble", 1.4, 1.95, 1.0, "cama")
_BED_SINGLE = _Piece("cama_sencilla", 1.0, 1.95, 1.0, "cama")
_CLOSET = _Piece("closet", 1.2, 0.6, 2.2, "closet")
_NIGHT = _Piece("mesa_noche", 0.45, 0.4, 0.55, "mesa_noche")
_TOILET = _Piece("sanitario", 0.4, 0.7, 0.78, "sanitario")
_SINK = _Piece("lavamanos", 0.55, 0.45, 0.85, "lavamanos")
_SHOWER = _Piece("ducha", 0.9, 0.9, 2.0, "ducha")
_COUNTER = _Piece("cocina_lineal", 2.4, 0.6, 0.91, "cocina")
_FRIDGE = _Piece("nevera", 0.7, 0.7, 1.8, "nevera")
_SOFA = _Piece("sofa_3", 2.0, 0.9, 0.82, "sofa")
_DINING = _Piece("comedor_4", 1.2, 1.6, 0.9, "comedor", wall=False)
_DESK = _Piece("escritorio", 1.2, 0.6, 0.75, "escritorio")
_WASHER = _Piece("lavadora", 0.6, 0.6, 0.85, "lavadora")

_PIECES = (
    _BED_DOUBLE, _BED_SINGLE, _CLOSET, _NIGHT, _TOILET, _SINK, _SHOWER,
    _COUNTER, _FRIDGE, _SOFA, _DINING, _DESK, _WASHER,
)  # fmt: skip
#: grupo de cada mueble del catálogo (el sofá de 2 y el sillón cuentan como sofá)
_GROUP = {p.catalog_id: p.group for p in _PIECES} | {"sofa_2": "sofa", "sillon": "sofa"}
#: va al lado de otro mueble (grupo, y si puede ir en otro muro cuando ahí no cabe)
_NEXT_TO = {"mesa_noche": ("cama", False), "nevera": ("cocina", True)}

#: área desde la que una alcoba lleva cama doble (m²)
DOUBLE_BED_AREA = 9.0


def _program(room: Room, area: float) -> tuple[_Piece, ...]:
    """Lo que debería tener el ambiente, en orden de prioridad (lo grande primero)."""
    kitchen = "COCINA" in room.label.upper()
    match room.room_type:
        case RoomType.BEDROOM:
            bed = _BED_DOUBLE if area >= DOUBLE_BED_AREA else _BED_SINGLE
            return (bed, _CLOSET, _NIGHT)
        case RoomType.BATHROOM:
            return (_SHOWER, _TOILET, _SINK)
        case RoomType.KITCHEN:
            return (_COUNTER, _FRIDGE)
        case RoomType.LIVING:
            return (_COUNTER, _FRIDGE, _SOFA, _DINING) if kitchen else (_SOFA, _DINING)
        case RoomType.STUDY:
            return (_DESK,)
        case RoomType.LAUNDRY:
            return (_WASHER,)
        case _:
            return ()


def _footprint(cx: float, cy: float, rot: float, width: float, depth: float) -> Polygon:
    """Huella en planta: x local = (cos r, sen r); el respaldo (-z) = (sen r, -cos r)."""
    ux, uy = math.cos(rot), math.sin(rot)
    bx, by = math.sin(rot), -math.cos(rot)
    hw, hd = width / 2, depth / 2
    return Polygon(
        [
            (cx + sx * hw * ux + sz * hd * bx, cy + sx * hw * uy + sz * hd * by)
            for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))
        ]
    )


def _of(f: Furniture) -> Polygon:
    return _footprint(f.position.x, f.position.y, f.rotation, f.width, f.depth)


def _blocked(level: Level) -> tuple[Polygon | None, Polygon | None]:
    """(barrido de puertas y pasos, franja frente a las ventanas) a ambos lados del muro."""
    doors: list[Polygon] = []
    windows: list[Polygon] = []
    for w in level.walls:
        if w.is_curved or w.length <= 0:
            continue
        ux = (w.end.x - w.start.x) / w.length
        uy = (w.end.y - w.start.y) / w.length
        nx, ny = -uy, ux
        for o in w.openings:
            reach = max(o.width, 0.8) if o.kind is OpeningKind.DOOR else 0.35
            a, b = w.point_at(o.offset), w.point_at(min(o.offset + o.width, w.length))
            zone = Polygon(
                [
                    (a.x + nx * reach, a.y + ny * reach),
                    (b.x + nx * reach, b.y + ny * reach),
                    (b.x - nx * reach, b.y - ny * reach),
                    (a.x - nx * reach, a.y - ny * reach),
                ]
            )
            (doors if o.kind is OpeningKind.DOOR else windows).append(zone)
    return (
        unary_union(doors) if doors else None,
        unary_union(windows) if windows else None,
    )


def _room_of(rooms: tuple[Room, ...], f: Furniture) -> Room | None:
    p = Point(f.position.x, f.position.y)
    return next((r for r in rooms if r.as_shapely().contains(p)), None)


def _fits(
    fp: Polygon,
    shape: Polygon,
    taken: list[Polygon],
    doors: Polygon | None,
    windows: Polygon | None,
    tall: bool,
) -> bool:
    if not shape.buffer(1e-3).contains(fp):
        return False
    if any(fp.intersects(t) for t in taken):
        return False
    if doors is not None and fp.intersects(doors):
        return False
    return not (tall and windows is not None and fp.intersects(windows))


def _against_wall(
    piece: _Piece,
    shape: Polygon,
    taken: list[Polygon],
    doors: Polygon | None,
    windows: Polygon | None,
    near: Point2D | None = None,
) -> tuple[float, float, float] | None:
    """(x, y, rotación) con el respaldo contra un lado del ambiente, o None.

    Sin ``near`` gana el lado más largo, en su punto más centrado; con ``near``, el punto
    libre más cercano a él (la nevera cerca del mesón aunque no quepa en su punta)."""
    found: list[tuple[float, float, float]] = []
    coords = list(shape.exterior.coords)
    edges = sorted(
        ((coords[i], coords[i + 1]) for i in range(len(coords) - 1)),
        key=lambda e: -math.dist(*e),
    )
    tall = piece.height > 1.2
    for (ax, ay), (bx, by) in edges:
        length = math.dist((ax, ay), (bx, by))
        if length < piece.width:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        nx, ny = -uy, ux
        mx, my = (ax + bx) / 2, (ay + by) / 2
        if not shape.contains(Point(mx + nx * 0.05, my + ny * 0.05)):
            nx, ny = -nx, -ny
        rot = math.atan2(-nx, ny)
        half = (length - piece.width) / 2
        # desde el centro del lado hacia las puntas, alternando
        steps = int(half / STEP)
        for k in sorted(range(-steps, steps + 1), key=abs):
            s = length / 2 + k * STEP
            d = piece.depth / 2 + GAP
            cx, cy = ax + ux * s + nx * d, ay + uy * s + ny * d
            fp = _footprint(cx, cy, rot, piece.width, piece.depth)
            if _fits(fp, shape, taken, doors, windows, tall):
                if near is None:
                    return cx, cy, rot
                found.append((cx, cy, rot))
    if near is None or not found:
        return None
    return min(found, key=lambda f: math.dist(f[:2], (near.x, near.y)))


def _free(
    piece: _Piece,
    shape: Polygon,
    taken: list[Polygon],
    doors: Polygon | None,
) -> tuple[float, float, float] | None:
    """Mueble suelto: el punto libre más cercano al centro del ambiente."""
    c = shape.centroid
    x0, y0, x1, y1 = shape.bounds
    spots = [
        (x0 + i * STEP, y0 + j * STEP)
        for i in range(int((x1 - x0) / STEP) + 1)
        for j in range(int((y1 - y0) / STEP) + 1)
    ]
    spots.sort(key=lambda p: math.dist(p, (c.x, c.y)))
    near = [t.buffer(FREE_CLEARANCE) for t in taken]
    for x, y in spots:
        for rot in (0.0, math.pi / 2):
            fp = _footprint(x, y, rot, piece.width, piece.depth)
            if not shape.buffer(-0.3).contains(fp):
                continue
            if any(fp.intersects(t) for t in near):
                continue
            if doors is not None and fp.intersects(doors):
                continue
            return x, y, rot
    return None


def _beside(
    piece: _Piece,
    anchor: Furniture,
    shape: Polygon,
    taken: list[Polygon],
    doors: Polygon | None,
    windows: Polygon | None,
) -> tuple[float, float, float] | None:
    """A un lado del mueble ancla y contra su mismo muro (la mesa de noche junto a la
    cabecera, la nevera en la punta del mesón)."""
    bed = anchor
    r = bed.rotation
    ux, uy = math.cos(r), math.sin(r)
    bx, by = math.sin(r), -math.cos(r)
    back = bed.depth / 2 - piece.depth / 2
    for side in (1, -1):
        off = side * (bed.width / 2 + piece.width / 2 + 0.05)
        cx = bed.position.x + bx * back + ux * off
        cy = bed.position.y + by * back + uy * off
        fp = _footprint(cx, cy, r, piece.width, piece.depth)
        if _fits(fp, shape, taken, doors, windows, tall=piece.height > 1.2):
            return cx, cy, r
    return None


def missing_furniture(level: Level) -> list[Furniture]:
    """Los muebles que le faltan a cada ambiente del piso (no toca los que ya tiene)."""
    doors, windows = _blocked(level)
    taken = [_of(f) for f in level.furniture]
    ids = {f.id for f in level.furniture}
    have: dict[str, set[str]] = {}
    anchors: dict[tuple[str, str], Furniture] = {}
    for f in level.furniture:
        room = _room_of(level.rooms, f)
        if room is not None:
            have.setdefault(room.id, set()).add(_GROUP.get(f.catalog_id, f.catalog_id))
            anchors.setdefault((room.id, _GROUP.get(f.catalog_id, f.catalog_id)), f)
    out: list[Furniture] = []
    for room in level.rooms:
        shape = room.as_shapely()
        groups = have.get(room.id, set())
        n = 0
        for piece in _program(room, room.area):
            if piece.group in groups:
                continue
            spot = None
            anchor_group, anywhere = _NEXT_TO.get(piece.catalog_id, ("", True))
            anchor = anchors.get((room.id, anchor_group))
            if anchor is not None:
                spot = _beside(piece, anchor, shape, taken, doors, windows)
            if spot is None and anywhere and piece.wall:
                at = anchor.position if anchor is not None else None
                spot = _against_wall(piece, shape, taken, doors, windows, at)
            elif spot is None and anywhere:
                spot = _free(piece, shape, taken, doors)
            if spot is None:
                continue
            x, y, rot = spot
            n += 1
            fid = f"f_{room.id}_c{n}"
            while fid in ids:
                n += 1
                fid = f"f_{room.id}_c{n}"
            ids.add(fid)
            f = Furniture(
                fid, piece.catalog_id, Point2D(x, y), piece.width, piece.depth, piece.height, rot
            )
            out.append(f)
            taken.append(_of(f))
            groups.add(piece.group)
            anchors.setdefault((room.id, piece.group), f)
    return out


def furnish(level: Level) -> Level:
    """El piso con lo dibujado más lo que faltaba."""
    extra = missing_furniture(level)
    return replace(level, furniture=(*level.furniture, *extra)) if extra else level
