"""Pisos apilados: sumar una planta de otro archivo, o copiar una, encima de las demás.

Cada lámina se dibuja con su propio origen, así que la planta nueva se alinea con la de
abajo por la retícula estructural: la traslación que hace coincidir más columnas. Sin
columnas, por la esquina exterior del edificio. La nueva va arriba de todo (elevación =
cima del último piso), con ids propios, y las escaleras de cada piso llevan al siguiente.
"""

from __future__ import annotations

import math
from dataclasses import replace

from plano3d.domain.building import BuildingModel, Level, Wall, new_id
from plano3d.domain.elements import WallKind

#: dos columnas a menos de esto (m) son la misma columna del eje
COLUMN_MATCH_M = 0.12


def fresh_ids(level: Level, level_id: str | None = None) -> Level:
    """La misma planta con ids nuevos en todo (y las referencias internas al día)."""
    walls = {w.id: new_id("w") for w in level.walls}
    dims = {d.id: new_id("d") for d in level.dimensions}

    def wall(w: Wall) -> Wall:
        measure = w.measure
        if measure.dimension_id in dims:
            measure = replace(measure, dimension_id=dims[measure.dimension_id])
        return replace(
            w,
            id=walls[w.id],
            measure=measure,
            openings=tuple(replace(o, id=new_id("op")) for o in w.openings),
        )

    return replace(
        level,
        id=level_id or new_id("lvl"),
        walls=tuple(wall(w) for w in level.walls),
        rooms=tuple(replace(r, id=new_id("r")) for r in level.rooms),
        columns=tuple(replace(c, id=new_id("c")) for c in level.columns),
        stairs=tuple(replace(s, id=new_id("s"), to_level_id=None) for s in level.stairs),
        dimensions=tuple(
            replace(d, id=dims[d.id], wall_ids=tuple(walls.get(i, i) for i in d.wall_ids))
            for d in level.dimensions
        ),
        labels=tuple(replace(t, id=new_id("t")) for t in level.labels),
        furniture=tuple(replace(f, id=new_id("f")) for f in level.furniture),
    )


def _outer_corner(level: Level) -> tuple[float, float] | None:
    walls = [w for w in level.walls if w.kind is WallKind.EXTERIOR] or list(level.walls)
    if not walls:
        return None
    xs = [min(w.start.x, w.end.x) - w.thickness / 2 for w in walls]
    ys = [min(w.start.y, w.end.y) - w.thickness / 2 for w in walls]
    return (min(xs), min(ys))


def grid_offset(base: Level, new: Level) -> tuple[float, float]:
    """Traslación (dx, dy) que lleva ``new`` sobre ``base``.

    Se prueba cada par (columna de abajo, columna nueva) y gana la traslación con la que
    coinciden más columnas; a igualdad, la de menor error. Así un voladizo o una columna
    de más en un piso no descuadran la retícula."""
    a = [(c.center.x, c.center.y) for c in base.columns]
    b = [(c.center.x, c.center.y) for c in new.columns]
    if len(a) >= 2 and len(b) >= 2:
        best: tuple[int, float, tuple[float, float]] | None = None
        for p in a:
            for q in b:
                dx, dy = p[0] - q[0], p[1] - q[1]
                hits, err = 0, 0.0
                for x, y in b:
                    d = min(math.dist((x + dx, y + dy), r) for r in a)
                    if d <= COLUMN_MATCH_M:
                        hits += 1
                        err += d
                if best is None or (hits, -err) > (best[0], -best[1]):
                    best = (hits, err, (dx, dy))
        if best is not None and best[0] >= 2:
            return best[2]
    ca, cb = _outer_corner(base), _outer_corner(new)
    if ca is None or cb is None:
        return (0.0, 0.0)
    return (ca[0] - cb[0], ca[1] - cb[1])


def link_stairs(model: BuildingModel) -> BuildingModel:
    """Las escaleras de cada piso llevan al de arriba (el último, a la cubierta: ninguno)."""
    levels = sorted(model.levels, key=lambda lv: lv.elevation)
    linked = []
    for k, lv in enumerate(levels):
        up = levels[k + 1].id if k + 1 < len(levels) else None
        linked.append(replace(lv, stairs=tuple(replace(s, to_level_id=up) for s in lv.stairs)))
    order = {lv.id: i for i, lv in enumerate(model.levels)}
    return replace(model, levels=tuple(sorted(linked, key=lambda lv: order[lv.id])))


def top_elevation(model: BuildingModel) -> float:
    return max((lv.elevation + lv.height for lv in model.levels), default=0.0)


def stack_level(
    model: BuildingModel, level: Level, name: str | None = None, align: bool = True
) -> BuildingModel:
    """``level`` encima del último piso, alineado con él por la retícula."""
    placed = fresh_ids(level)
    if align and model.levels:
        below = max(model.levels, key=lambda lv: lv.elevation)
        dx, dy = grid_offset(below, placed)
        if dx or dy:
            placed = placed.translated(dx, dy)
    placed = replace(
        placed,
        name=(name or "").strip()[:80] or f"Piso {len(model.levels) + 1}",
        elevation=round(top_elevation(model), 4),
    )
    return link_stairs(model.with_level(placed))
