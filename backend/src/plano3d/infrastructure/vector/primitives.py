"""Primitivas de un dibujo vectorial (DXF o PDF) ya llevadas a METROS, con y hacia abajo.

Los lectores (``dxf.py``, ``pdf.py``) convierten su formato a un ``Drawing``; el resto del
importador (``walls.py``, ``builder.py``) no sabe de qué archivo vino.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from enum import StrEnum

Pt = tuple[float, float]


@dataclass(frozen=True, slots=True)
class Line:
    x1: float
    y1: float
    x2: float
    y2: float
    layer: str = ""

    @property
    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    @property
    def direction(self) -> Pt:
        n = self.length or 1.0
        return (self.x2 - self.x1) / n, (self.y2 - self.y1) / n

    @property
    def angle(self) -> float:
        """Grados en [0, 180)."""
        return math.degrees(math.atan2(self.y2 - self.y1, self.x2 - self.x1)) % 180.0

    @property
    def p1(self) -> Pt:
        return (self.x1, self.y1)

    @property
    def p2(self) -> Pt:
        return (self.x2, self.y2)

    def moved(self, dx: float, dy: float) -> Line:
        return Line(self.x1 + dx, self.y1 + dy, self.x2 + dx, self.y2 + dy, self.layer)


@dataclass(frozen=True, slots=True)
class ArcPrim:
    """Arco de circunferencia: ángulos en radianes medidos con atan2 en coordenadas de
    imagen (y abajo), barrido de ``start`` a ``start + sweep`` (``sweep`` con signo)."""

    cx: float
    cy: float
    r: float
    start: float
    sweep: float
    layer: str = ""

    def point(self, t: float) -> Pt:
        a = self.start + self.sweep * t
        return (self.cx + self.r * math.cos(a), self.cy + self.r * math.sin(a))

    @property
    def p1(self) -> Pt:
        return self.point(0.0)

    @property
    def p2(self) -> Pt:
        return self.point(1.0)

    @property
    def length(self) -> float:
        return abs(self.sweep) * self.r

    def interval(self) -> tuple[float, float]:
        """Intervalo angular creciente [lo, hi] (hi - lo = |sweep|)."""
        lo = self.start if self.sweep >= 0 else self.start + self.sweep
        return lo, lo + abs(self.sweep)

    def moved(self, dx: float, dy: float) -> ArcPrim:
        return ArcPrim(self.cx + dx, self.cy + dy, self.r, self.start, self.sweep, self.layer)

    def polyline(self, max_step: float = 0.05) -> list[Pt]:
        n = max(4, math.ceil(self.length / max_step))
        return [self.point(i / n) for i in range(n + 1)]


@dataclass(frozen=True, slots=True)
class Text:
    x: float
    y: float
    text: str
    height: float = 0.0
    rotation: float = 0.0  # radianes
    layer: str = ""

    def moved(self, dx: float, dy: float) -> Text:
        return Text(self.x + dx, self.y + dy, self.text, self.height, self.rotation, self.layer)


@dataclass(frozen=True, slots=True)
class DimPrim:
    """Cota del archivo: puntos medidos, valor (m), texto mostrado y orientación."""

    a: Pt
    b: Pt
    value: float
    text: str = ""
    axis: str = "aligned"  # aligned | horizontal | vertical
    offset: float = 0.0
    layer: str = ""
    confidence: float = 1.0  # de la lectura (OCR/VLM); 1 en archivos vectoriales

    def moved(self, dx: float, dy: float) -> DimPrim:
        return DimPrim(
            (self.a[0] + dx, self.a[1] + dy),
            (self.b[0] + dx, self.b[1] + dy),
            self.value,
            self.text,
            self.axis,
            self.offset,
            self.layer,
            self.confidence,
        )


@dataclass(frozen=True, slots=True)
class Insert:
    """Bloque insertado (p. ej. una puerta o ventana de biblioteca)."""

    x: float
    y: float
    name: str
    layer: str = ""

    def moved(self, dx: float, dy: float) -> Insert:
        return Insert(self.x + dx, self.y + dy, self.name, self.layer)


@dataclass(frozen=True, slots=True)
class Closed:
    """Contorno cerrado pequeño (candidato a columna) y si está relleno."""

    points: tuple[Pt, ...]
    filled: bool = False
    layer: str = ""

    def moved(self, dx: float, dy: float) -> Closed:
        return Closed(tuple((x + dx, y + dy) for x, y in self.points), self.filled, self.layer)


@dataclass
class Drawing:
    """Todo lo que se leyó del archivo, en metros y con y hacia abajo."""

    lines: list[Line] = field(default_factory=list)
    arcs: list[ArcPrim] = field(default_factory=list)
    texts: list[Text] = field(default_factory=list)
    dims: list[DimPrim] = field(default_factory=list)
    inserts: list[Insert] = field(default_factory=list)
    closed: list[Closed] = field(default_factory=list)
    #: líneas de detalle (contenido de bloques de puertas/ventanas, capas de aberturas)
    detail_lines: list[Line] = field(default_factory=list)
    detail_arcs: list[ArcPrim] = field(default_factory=list)
    #: True si la escala del archivo es la real (DXF con unidades, PDF con escala leída)
    exact_scale: bool = True

    def bounds(self) -> tuple[float, float, float, float]:
        xs: list[float] = []
        ys: list[float] = []
        for ln in (*self.lines, *self.detail_lines):
            xs += [ln.x1, ln.x2]
            ys += [ln.y1, ln.y2]
        for a in (*self.arcs, *self.detail_arcs):
            xs += [a.cx - a.r, a.cx + a.r]
            ys += [a.cy - a.r, a.cy + a.r]
        for t in self.texts:
            xs.append(t.x)
            ys.append(t.y)
        if not xs:
            return (0.0, 0.0, 0.0, 0.0)
        return (min(xs), min(ys), max(xs), max(ys))

    def moved(self, dx: float, dy: float) -> Drawing:
        return Drawing(
            [ln.moved(dx, dy) for ln in self.lines],
            [a.moved(dx, dy) for a in self.arcs],
            [t.moved(dx, dy) for t in self.texts],
            [d.moved(dx, dy) for d in self.dims],
            [i.moved(dx, dy) for i in self.inserts],
            [c.moved(dx, dy) for c in self.closed],
            [ln.moved(dx, dy) for ln in self.detail_lines],
            [a.moved(dx, dy) for a in self.detail_arcs],
            self.exact_scale,
        )


# ----------------------------------------------------------------------------- capas


class LayerRole(StrEnum):
    WALL = "wall"
    OPENING = "opening"  # puertas y ventanas
    COLUMN = "column"
    STAIR = "stair"
    IGNORE = "ignore"  # cotas, textos, muebles, ejes, instalaciones...
    UNKNOWN = "unknown"


_ROLES: tuple[tuple[LayerRole, re.Pattern[str]], ...] = (
    (
        LayerRole.OPENING,
        re.compile(r"PUERT|DOOR|VENTAN|WINDOW|VANO|CARPINT|A-DOOR|A-GLAZ", re.IGNORECASE),
    ),
    (LayerRole.COLUMN, re.compile(r"COLUM|COLUMN|PILAR|ESTRUCT|S-COLS|A-COLS", re.IGNORECASE)),
    (LayerRole.STAIR, re.compile(r"ESCALER|STAIR|A-FLOR-STRS", re.IGNORECASE)),
    (
        LayerRole.WALL,
        re.compile(
            r"MUR|WALL|MAMPOST|TABIQ|FACHAD|DRYWALL|BLOQUE|LADRILL|A-WALL|CERRAMIENTO",
            re.IGNORECASE,
        ),
    ),
    (
        LayerRole.IGNORE,
        re.compile(
            r"COTA|DIM|TEXT|NOTA|MOBIL|MUEBLE|FURN|EQUIP|EJE|AXIS|GRID|ACHUR|HATCH|SOMBR|"
            r"DEFPOINTS|ROTUL|MARCO|TITLE|SANIT|APARAT|ELECT|HIDRA|ILUM|PISO|PAVIM|VEGET|"
            r"JARDIN|NIVEL|CORTE|A-ANNO|A-FURN",
            re.IGNORECASE,
        ),
    ),
)


def layer_role(name: str) -> LayerRole:
    for role, pattern in _ROLES:
        if pattern.search(name):
            return role
    return LayerRole.UNKNOWN


_DOOR_BLOCK = re.compile(r"PUERT|DOOR|P\d|^P[-_ ]", re.IGNORECASE)
_WINDOW_BLOCK = re.compile(r"VENTAN|WINDOW|V\d|^V[-_ ]", re.IGNORECASE)


def block_kind(name: str) -> str | None:
    if _WINDOW_BLOCK.search(name):
        return "window"
    if _DOOR_BLOCK.search(name):
        return "door"
    return None
