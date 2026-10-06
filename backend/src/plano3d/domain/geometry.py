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


@dataclass(frozen=True, slots=True)
class Arc:
    """Arco circular entre dos puntos definido por su flecha (``bulge``, en metros).

    Convención: ``bulge`` > 0 curva el arco hacia la normal IZQUIERDA de start → end,
    es decir hacia (-dy, dx) en coordenadas de imagen (y hacia abajo). |bulge| es la
    distancia del punto medio de la cuerda al punto medio del arco.
    """

    start: Point2D
    end: Point2D
    bulge: float

    def __post_init__(self) -> None:
        if abs(self.bulge) < 1e-9:
            raise ValueError("Un arco necesita flecha distinta de cero")
        if abs(self.bulge) > self.chord / 2 + 1e-9:
            raise ValueError(
                "La flecha no puede superar media cuerda (más de media circunferencia)"
            )

    @property
    def chord(self) -> float:
        return self.start.distance_to(self.end)

    @property
    def radius(self) -> float:
        c, s = self.chord, abs(self.bulge)
        return (c * c / 4 + s * s) / (2 * s)

    @property
    def center(self) -> Point2D:
        c = self.chord
        dx, dy = (self.end.x - self.start.x) / c, (self.end.y - self.start.y) / c
        nx, ny = -dy, dx
        sign = 1.0 if self.bulge > 0 else -1.0
        d = self.radius - abs(self.bulge)
        mx, my = (self.start.x + self.end.x) / 2, (self.start.y + self.end.y) / 2
        return Point2D(mx - sign * nx * d, my - sign * ny * d)

    @property
    def start_angle(self) -> float:
        c = self.center
        return math.atan2(self.start.y - c.y, self.start.x - c.x)

    @property
    def sweep(self) -> float:
        """Ángulo barrido con signo (rad) de ``start`` a ``end`` pasando por la flecha."""
        half = 2 * math.asin(min(1.0, self.chord / (2 * self.radius)))
        theta = half if abs(self.bulge) <= self.radius else 2 * math.pi - half
        # sentido: la flecha a la izquierda equivale a girar en sentido horario en pantalla
        return -theta if self.bulge > 0 else theta

    @property
    def length(self) -> float:
        return abs(self.sweep) * self.radius

    def point_at(self, s: float) -> Point2D:
        """Punto a la distancia ``s`` (metros, sobre el arco) desde ``start``."""
        c = self.center
        a = self.start_angle + self.sweep * (s / self.length)
        return Point2D(c.x + self.radius * math.cos(a), c.y + self.radius * math.sin(a))

    def sample(self, max_step: float = 0.1) -> tuple[Point2D, ...]:
        n = max(4, math.ceil(self.length / max_step))
        return tuple(self.point_at(self.length * i / n) for i in range(n + 1))
