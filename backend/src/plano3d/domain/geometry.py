"""Value objects geométricos. Todas las coordenadas del dominio están en METROS."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Point2D:
    x: float
    y: float

    def __post_init__(self) -> None:
        if not (math.isfinite(self.x) and math.isfinite(self.y)):
            raise ValueError(f"Coordenadas no finitas: ({self.x}, {self.y})")

    def distance_to(self, other: Point2D) -> float:
        return math.hypot(other.x - self.x, other.y - self.y)

    def translated(self, dx: float, dy: float) -> Point2D:
        return Point2D(self.x + dx, self.y + dy)

    def scaled(self, factor: float) -> Point2D:
        return Point2D(self.x * factor, self.y * factor)


def polygon_area(points: tuple[Point2D, ...]) -> float:
    """Área absoluta por la fórmula del lazo (shoelace)."""
    n = len(points)
    if n < 3:
        return 0.0
    acc = 0.0
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        acc += a.x * b.y - b.x * a.y
    return abs(acc) / 2.0


def polygon_centroid(points: tuple[Point2D, ...]) -> Point2D:
    """Centroide del área; si el polígono es degenerado, promedio de vértices."""
    n = len(points)
    signed = 0.0
    cx = cy = 0.0
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        cross = a.x * b.y - b.x * a.y
        signed += cross
        cx += (a.x + b.x) * cross
        cy += (a.y + b.y) * cross
    if abs(signed) < 1e-12:
        return Point2D(sum(p.x for p in points) / n, sum(p.y for p in points) / n)
    signed *= 0.5
    return Point2D(cx / (6 * signed), cy / (6 * signed))
