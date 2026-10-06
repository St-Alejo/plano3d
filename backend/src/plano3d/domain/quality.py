"""Tasa de corrección: cuánto tuvo que corregir una persona lo que detectó la máquina.

Compara el modelo de la detección automática con la versión corregida y guardada.
Es la métrica más honesta de la calidad del detector en uso real, y además
convierte cada proyecto corregido en un caso del golden set.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from plano3d.domain.building import BuildingModel, Wall
from plano3d.domain.geometry import Point2D

MOVED_TOLERANCE_M = 0.02  # por debajo de 2 cm se considera el mismo muro sin tocar
MATCH_RADIUS_M = 0.50  # más allá de 50 cm ya no es "el mismo muro movido"
OPENING_MATCH_M = 0.30


@dataclass(frozen=True)
class CorrectionStats:
    walls_detected: int
    walls_final: int
    walls_unchanged: int
    walls_moved: int
    walls_added: int
    walls_deleted: int
    openings_added: int
    openings_deleted: int
    openings_kind_changed: int
    rooms_relabeled: int
    area_detected_m2: float
    area_final_m2: float

    @property
    def correction_rate(self) -> float:
        """Fracción de muros detectados que hubo que mover, borrar o agregar."""
        edits = self.walls_moved + self.walls_added + self.walls_deleted
        return edits / max(1, self.walls_detected)


def _wall_distance(a: Wall, b: Wall) -> float:
    """Distancia entre muros sin importar el sentido en que se dibujaron."""
    same = max(a.start.distance_to(b.start), a.end.distance_to(b.end))
    flipped = max(a.start.distance_to(b.end), a.end.distance_to(b.start))
    return min(same, flipped)


def _walls(m: BuildingModel) -> list[Wall]:
    return [w for lv in m.levels for w in lv.walls]


def _match(detected: list[Wall], final: list[Wall]) -> list[tuple[Wall, Wall, float]]:
    """Emparejamiento voraz por distancia creciente (suficiente para planos de vivienda)."""
    candidates = sorted(
        ((_wall_distance(d, f), i, j) for i, d in enumerate(detected) for j, f in enumerate(final)),
        key=lambda t: t[0],
    )
    used_d: set[int] = set()
    used_f: set[int] = set()
    pairs: list[tuple[Wall, Wall, float]] = []
    for dist, i, j in candidates:
        if dist > MATCH_RADIUS_M:
            break
        if i in used_d or j in used_f:
            continue
        used_d.add(i)
        used_f.add(j)
        pairs.append((detected[i], final[j], dist))
    return pairs


def _opening_centers(m: BuildingModel) -> list[tuple[Point2D, str]]:
    return [
        (w.point_at(o.offset + o.width / 2), o.kind.value)
        for lv in m.levels
        for w in lv.walls
        for o in w.openings
    ]


def correction_stats(detected: BuildingModel, final: BuildingModel) -> CorrectionStats:
    dw, fw = _walls(detected), _walls(final)
    pairs = _match(dw, fw)
    moved = sum(1 for _, _, d in pairs if d > MOVED_TOLERANCE_M)

    d_ops, f_ops = _opening_centers(detected), _opening_centers(final)
    matched_f: set[int] = set()
    kind_changed = 0
    for p, kind in d_ops:
        best = min(
            (
                (math.dist((p.x, p.y), (q.x, q.y)), j)
                for j, (q, _) in enumerate(f_ops)
                if j not in matched_f
            ),
            default=None,
        )
        if best and best[0] <= OPENING_MATCH_M:
            matched_f.add(best[1])
            kind_changed += f_ops[best[1]][1] != kind

    d_rooms = {r.id: r.label for lv in detected.levels for r in lv.rooms}
    f_rooms = {r.id: r.label for lv in final.levels for r in lv.rooms}
    relabeled = sum(1 for rid, label in f_rooms.items() if rid in d_rooms and d_rooms[rid] != label)

    return CorrectionStats(
        walls_detected=len(dw),
        walls_final=len(fw),
        walls_unchanged=len(pairs) - moved,
        walls_moved=moved,
        walls_added=len(fw) - len(pairs),
        walls_deleted=len(dw) - len(pairs),
        openings_added=len(f_ops) - len(matched_f),
        openings_deleted=len(d_ops) - len(matched_f),
        openings_kind_changed=kind_changed,
        rooms_relabeled=relabeled,
        area_detected_m2=round(detected.total_area, 3),
        area_final_m2=round(final.total_area, 3),
    )
