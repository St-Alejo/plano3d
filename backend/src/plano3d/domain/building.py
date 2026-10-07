"""Modelo canónico del edificio (BuildingModel): la única fuente de verdad.

Reglas de diseño (ver docs/adr/ADR-003-modelo-canonico.md):
- Unidades: metros. La relación con la imagen original la da ``Scale``.
- Entidades inmutables: toda modificación devuelve una copia nueva. Esto hace
  triviales el deshacer/rehacer (patrón Command) y la comparación de versiones.
- Las invariantes se validan en el constructor: un objeto inválido no puede existir.
- Los valores derivados (longitud, área) se calculan, nunca se almacenan.

Versión 2 del esquema (ADR-012): muros curvos y su tipo, procedencia de cada medida
(exacta / inferida / en conflicto), tipo de ambiente y huecos, columnas, escaleras, cotas
y textos leídos del plano. Todo campo nuevo tiene un valor por defecto, así que un modelo
v1 guardado se lee sin migrar datos.
"""

from __future__ import annotations

import itertools
import uuid
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Literal

from shapely.geometry import Polygon

from plano3d.domain.elements import (
    MATERIAL_ID,
    Column,
    Dimension,
    Furniture,
    Measure,
    OpeningOperation,
    RoomType,
    Stair,
    TextLabel,
    WallKind,
    check_confidence,
)
from plano3d.domain.errors import (
    EntityNotFoundError,
    InvalidGeometryError,
    OpeningDoesNotFitError,
)
from plano3d.domain.geometry import Arc, Point2D, polygon_area, polygon_centroid

MODEL_SCHEMA_VERSION = 2
EPS = 1e-6
MIN_WALL_LENGTH = 0.05  # metros
MAX_ROOM_OVERLAP_RATIO = 0.02


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class OpeningKind(StrEnum):
    DOOR = "door"
    WINDOW = "window"


@dataclass(frozen=True, slots=True)
class Opening:
    """Hueco en un muro. ``offset`` se mide desde ``Wall.start`` a lo largo del muro."""

    id: str
    kind: OpeningKind
    offset: float
    width: float
    height: float
    sill: float = 0.0
    confidence: float = 1.0
    #: cómo abre (None = no se sabe todavía)
    operation: OpeningOperation | None = None
    #: la bisagra está en el extremo final (offset + width) en vez del inicial
    hinge_at_end: bool = False
    #: abre hacia la normal izquierda del muro (-dy, dx); False = hacia la derecha
    opens_left: bool = True

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise InvalidGeometryError("Una abertura necesita ancho y alto positivos")
        if self.offset < -EPS or self.sill < -EPS:
            raise InvalidGeometryError("offset y sill no pueden ser negativos")
        _check_confidence(self.confidence)

    @property
    def end(self) -> float:
        return self.offset + self.width

    def overlaps(self, other: Opening) -> bool:
        return self.offset < other.end - EPS and other.offset < self.end - EPS

    def scaled(self, factor: float) -> Opening:
        """Escala solo las medidas horizontales (en planta); las alturas son absolutas."""
        return replace(self, offset=self.offset * factor, width=self.width * factor)


@dataclass(frozen=True, slots=True)
class Wall:
    id: str
    start: Point2D
    end: Point2D
    thickness: float = 0.15
    height: float = 2.6
    material: str = "plaster"
    openings: tuple[Opening, ...] = ()
    confidence: float = 1.0
    #: flecha del arco (m); 0 = muro recto. Ver ``geometry.Arc`` para el signo.
    bulge: float = 0.0
    kind: WallKind = WallKind.UNKNOWN
    structural: bool = False
    #: de dónde sale su longitud y qué tan exacta es
    measure: Measure = field(default_factory=Measure)

    def __post_init__(self) -> None:
        if abs(self.bulge) > EPS:
            try:
                Arc(self.start, self.end, self.bulge)
            except ValueError as exc:
                raise InvalidGeometryError(f"Muro curvo {self.id} inválido: {exc}") from exc
        if self.length < MIN_WALL_LENGTH:
            raise InvalidGeometryError(
                f"El muro {self.id} mide {self.length:.3f} m (mínimo {MIN_WALL_LENGTH} m)"
            )
        if self.thickness <= 0 or self.height <= 0:
            raise InvalidGeometryError("Grosor y altura del muro deben ser positivos")
        _check_confidence(self.confidence)
        self._check_openings()

    def _check_openings(self) -> None:
        ordered = sorted(self.openings, key=lambda o: o.offset)
        for op in ordered:
            if op.end > self.length + EPS:
                raise OpeningDoesNotFitError(
                    f"La abertura {op.id} termina en {op.end:.2f} m pero el muro mide "
                    f"{self.length:.2f} m"
                )
            if op.sill + op.height > self.height + EPS:
                raise OpeningDoesNotFitError(f"La abertura {op.id} es más alta que el muro")
        for a, b in itertools.pairwise(ordered):
            if a.overlaps(b):
                raise OpeningDoesNotFitError(f"Las aberturas {a.id} y {b.id} se solapan")

    @property
    def is_curved(self) -> bool:
        return abs(self.bulge) > EPS

    @property
    def arc(self) -> Arc | None:
        return Arc(self.start, self.end, self.bulge) if self.is_curved else None

    @property
    def chord(self) -> float:
        return self.start.distance_to(self.end)

    @property
    def length(self) -> float:
        """Longitud a lo largo del eje (la del arco si el muro es curvo)."""
        arc = self.arc
        return arc.length if arc else self.chord

    def point_at(self, offset: float) -> Point2D:
        arc = self.arc
        if arc:
            return arc.point_at(offset)
        t = offset / self.length
        return Point2D(
            self.start.x + (self.end.x - self.start.x) * t,
            self.start.y + (self.end.y - self.start.y) * t,
        )

    def with_endpoints(self, start: Point2D, end: Point2D) -> Wall:
        return replace(self, start=start, end=end)

    def with_opening(self, opening: Opening) -> Wall:
        return replace(self, openings=(*self.openings, opening))

    def without_opening(self, opening_id: str) -> Wall:
        if all(o.id != opening_id for o in self.openings):
            raise EntityNotFoundError(f"Abertura {opening_id} no existe en {self.id}")
        return replace(self, openings=tuple(o for o in self.openings if o.id != opening_id))

    def with_measure(self, measure: Measure) -> Wall:
        return replace(self, measure=measure)

    def scaled(self, factor: float) -> Wall:
        return replace(
            self,
            start=self.start.scaled(factor),
            end=self.end.scaled(factor),
            thickness=self.thickness * factor,
            bulge=self.bulge * factor,
            openings=tuple(o.scaled(factor) for o in self.openings),
        )

    def translated(self, dx: float, dy: float) -> Wall:
        """Las aberturas se miden desde el inicio del muro: se mueven con él."""
        return replace(self, start=self.start.translated(dx, dy), end=self.end.translated(dx, dy))


@dataclass(frozen=True, slots=True)
class Room:
    id: str
    label: str
    polygon: tuple[Point2D, ...]
    confidence: float = 1.0
    room_type: RoomType = RoomType.OTHER
    #: huecos interiores (patios de luz, buitrones), cada uno como anillo de puntos
    holes: tuple[tuple[Point2D, ...], ...] = ()
    #: área escrita en el plano ("A= 12,50 m²"), para validar el polígono
    declared_area: float | None = None
    #: acabado de piso elegido en el editor (None = según el tipo de ambiente)
    floor_material: str | None = None

    def __post_init__(self) -> None:
        if len(self.polygon) < 3 or any(len(h) < 3 for h in self.holes):
            raise InvalidGeometryError(f"La habitación {self.id} necesita al menos 3 vértices")
        _check_confidence(self.confidence)
        if self.declared_area is not None and self.declared_area <= 0:
            raise InvalidGeometryError(f"El área declarada de {self.id} debe ser positiva")
        if self.floor_material is not None and not MATERIAL_ID.match(self.floor_material):
            raise InvalidGeometryError(f"Material de piso inválido en {self.id}")
        shape = self.as_shapely()
        if not shape.is_valid or shape.area <= EPS:
            raise InvalidGeometryError(f"El polígono de la habitación {self.id} no es válido")

    @property
    def area(self) -> float:
        if self.holes:
            return float(self.as_shapely().area)
        return polygon_area(self.polygon)

    @property
    def area_deviation(self) -> float | None:
        """Área del polígono menos la declarada en el plano (m²), si hay declarada."""
        return None if self.declared_area is None else self.area - self.declared_area

    @property
    def centroid(self) -> Point2D:
        return polygon_centroid(self.polygon)

    def as_shapely(self) -> Polygon:
        return Polygon(
            [(p.x, p.y) for p in self.polygon], [[(p.x, p.y) for p in h] for h in self.holes]
        )

    def relabeled(self, label: str) -> Room:
        return replace(self, label=label)

    def scaled(self, factor: float) -> Room:
        return replace(
            self,
            polygon=tuple(p.scaled(factor) for p in self.polygon),
            holes=tuple(tuple(p.scaled(factor) for p in h) for h in self.holes),
        )

    def translated(self, dx: float, dy: float) -> Room:
        return replace(
            self,
            polygon=tuple(p.translated(dx, dy) for p in self.polygon),
            holes=tuple(tuple(p.translated(dx, dy) for p in h) for h in self.holes),
        )


@dataclass(frozen=True, slots=True)
class Level:
    id: str
    name: str
    elevation: float = 0.0
    walls: tuple[Wall, ...] = ()
    rooms: tuple[Room, ...] = ()
    #: altura de entrepiso (piso a piso), m
    height: float = 2.6
    columns: tuple[Column, ...] = ()
    stairs: tuple[Stair, ...] = ()
    dimensions: tuple[Dimension, ...] = ()
    labels: tuple[TextLabel, ...] = ()
    furniture: tuple[Furniture, ...] = ()

    def __post_init__(self) -> None:
        if self.height <= 0:
            raise InvalidGeometryError(f"El nivel {self.id} necesita altura positiva")
        _check_unique_ids("muro", [w.id for w in self.walls])
        _check_unique_ids("habitación", [r.id for r in self.rooms])
        _check_unique_ids("columna", [c.id for c in self.columns])
        _check_unique_ids("escalera", [s.id for s in self.stairs])
        _check_unique_ids("cota", [d.id for d in self.dimensions])
        _check_unique_ids("mueble", [f.id for f in self.furniture])
        shapes = [(r.id, r.as_shapely()) for r in self.rooms]
        for i, (id_a, a) in enumerate(shapes):
            for id_b, b in shapes[i + 1 :]:
                overlap = a.intersection(b).area
                if overlap > MAX_ROOM_OVERLAP_RATIO * min(a.area, b.area):
                    raise InvalidGeometryError(f"Las habitaciones {id_a} y {id_b} se solapan")

    def wall(self, wall_id: str) -> Wall:
        for w in self.walls:
            if w.id == wall_id:
                return w
        raise EntityNotFoundError(f"Muro {wall_id} no existe en el nivel {self.id}")

    def room(self, room_id: str) -> Room:
        for r in self.rooms:
            if r.id == room_id:
                return r
        raise EntityNotFoundError(f"Habitación {room_id} no existe en el nivel {self.id}")

    def with_wall(self, wall: Wall) -> Level:
        """Agrega el muro, o lo reemplaza si ya existe uno con el mismo id."""
        if any(w.id == wall.id for w in self.walls):
            return replace(self, walls=tuple(wall if w.id == wall.id else w for w in self.walls))
        return replace(self, walls=(*self.walls, wall))

    def without_wall(self, wall_id: str) -> Level:
        self.wall(wall_id)
        return replace(self, walls=tuple(w for w in self.walls if w.id != wall_id))

    def with_room(self, room: Room) -> Level:
        if any(r.id == room.id for r in self.rooms):
            return replace(self, rooms=tuple(room if r.id == room.id else r for r in self.rooms))
        return replace(self, rooms=(*self.rooms, room))

    @property
    def total_area(self) -> float:
        return sum(r.area for r in self.rooms)

    def dimension(self, dimension_id: str) -> Dimension:
        for d in self.dimensions:
            if d.id == dimension_id:
                return d
        raise EntityNotFoundError(f"Cota {dimension_id} no existe en el nivel {self.id}")

    def with_dimension(self, dim: Dimension) -> Level:
        """Agrega la cota, o la reemplaza si ya existe una con el mismo id."""
        if any(d.id == dim.id for d in self.dimensions):
            dims = tuple(dim if d.id == dim.id else d for d in self.dimensions)
            return replace(self, dimensions=dims)
        return replace(self, dimensions=(*self.dimensions, dim))

    def scaled(self, factor: float) -> Level:
        return replace(
            self,
            walls=tuple(w.scaled(factor) for w in self.walls),
            rooms=tuple(r.scaled(factor) for r in self.rooms),
            columns=tuple(c.scaled(factor) for c in self.columns),
            stairs=tuple(s.scaled(factor) for s in self.stairs),
            dimensions=tuple(d.scaled(factor) for d in self.dimensions),
            labels=tuple(t.scaled(factor) for t in self.labels),
            furniture=tuple(f.scaled(factor) for f in self.furniture),
        )

    def translated(self, dx: float, dy: float) -> Level:
        """Mueve toda la planta en el plano (para alinear niveles dibujados por separado)."""
        return replace(
            self,
            walls=tuple(w.translated(dx, dy) for w in self.walls),
            rooms=tuple(r.translated(dx, dy) for r in self.rooms),
            columns=tuple(c.translated(dx, dy) for c in self.columns),
            stairs=tuple(s.translated(dx, dy) for s in self.stairs),
            dimensions=tuple(d.translated(dx, dy) for d in self.dimensions),
            labels=tuple(t.translated(dx, dy) for t in self.labels),
            furniture=tuple(f.translated(dx, dy) for f in self.furniture),
        )


#: default = sin información; estimated = heurística de la imagen; calibrated = el usuario
#: marcó una distancia; dimensions = ajustada a las cotas leídas; vector = archivo DXF/PDF
ScaleSource = Literal["default", "estimated", "calibrated", "dimensions", "vector"]


@dataclass(frozen=True, slots=True)
class Scale:
    """Metros por píxel de la imagen rectificada."""

    meters_per_pixel: float
    source: ScaleSource = "estimated"
    confidence: float = 0.5

    def __post_init__(self) -> None:
        if self.meters_per_pixel <= 0:
            raise InvalidGeometryError("La escala debe ser positiva")
        _check_confidence(self.confidence)


@dataclass(frozen=True, slots=True)
class SourceImage:
    """Imagen rectificada sobre la que se detectó el modelo (para el editor 2D)."""

    key: str
    width_px: int
    height_px: int


@dataclass(frozen=True, slots=True)
class BuildingModel:
    project_id: str
    scale: Scale
    levels: tuple[Level, ...] = field(default_factory=tuple)
    source_image: SourceImage | None = None
    schema_version: int = MODEL_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not 1 <= self.schema_version <= MODEL_SCHEMA_VERSION:
            raise InvalidGeometryError(
                f"Versión de esquema {self.schema_version} no soportada "
                f"(máximo {MODEL_SCHEMA_VERSION})"
            )
        _check_unique_ids("nivel", [lv.id for lv in self.levels])

    def level(self, level_id: str) -> Level:
        for lv in self.levels:
            if lv.id == level_id:
                return lv
        raise EntityNotFoundError(f"Nivel {level_id} no existe")

    def with_level(self, level: Level) -> BuildingModel:
        if any(lv.id == level.id for lv in self.levels):
            return replace(
                self, levels=tuple(level if lv.id == level.id else lv for lv in self.levels)
            )
        return replace(self, levels=(*self.levels, level))

    @property
    def total_area(self) -> float:
        return sum(lv.total_area for lv in self.levels)

    def recalibrated(self, meters_per_pixel: float) -> BuildingModel:
        """Cambia la escala y re-escala toda la geometría en planta de forma consistente."""
        factor = meters_per_pixel / self.scale.meters_per_pixel
        return replace(
            self,
            scale=Scale(meters_per_pixel, source="calibrated", confidence=1.0),
            levels=tuple(lv.scaled(factor) for lv in self.levels),
        )


_check_confidence = check_confidence


def _check_unique_ids(kind: str, ids: list[str]) -> None:
    if len(ids) != len(set(ids)):
        raise InvalidGeometryError(f"Hay ids de {kind} duplicados")
