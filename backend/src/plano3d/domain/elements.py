"""Elementos del modelo v2 (ADR-012): procedencia de las medidas, columnas, escaleras,
cotas y textos del plano.

Mismas reglas que ``building``: metros, inmutables, invariantes en el constructor.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace
from enum import StrEnum

from plano3d.domain.errors import InvalidGeometryError
from plano3d.domain.geometry import Point2D


def check_confidence(value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise InvalidGeometryError(f"La confianza debe estar entre 0 y 1 (recibido {value})")


# ----------------------------------------------------------------------------- medidas


class MeasureStatus(StrEnum):
    """Qué tan cierta es una medida respecto al plano original."""

    EXACT = "exact"  # respaldada por una cota leída con consenso, o por un archivo vectorial
    INFERRED = "inferred"  # sale de la escala de la imagen: aproximada
    CONFLICT = "conflict"  # las cotas no cierran o contradicen la geometría: revisar


class MeasureSource(StrEnum):
    SCALE = "scale"  # píxeles x escala estimada
    DIMENSION = "dimension"  # cota leída del plano (OCR / VLM)
    VECTOR = "vector"  # DXF o PDF vectorial: exacta por construcción
    MANUAL = "manual"  # la escribió o confirmó el usuario


@dataclass(frozen=True, slots=True)
class Measure:
    """Procedencia de una longitud del modelo.

    ``error`` es la incertidumbre estimada en metros (± error). ``dimension_id`` enlaza la
    cota que la respalda, si la hay.
    """

    status: MeasureStatus = MeasureStatus.INFERRED
    source: MeasureSource = MeasureSource.SCALE
    error: float = 0.0
    dimension_id: str | None = None

    def __post_init__(self) -> None:
        if self.error < 0 or not math.isfinite(self.error):
            raise InvalidGeometryError("El error de una medida debe ser finito y no negativo")


# ----------------------------------------------------------------------------- ambientes


class RoomType(StrEnum):
    BEDROOM = "bedroom"  # alcoba
    BATHROOM = "bathroom"  # baño
    KITCHEN = "kitchen"  # cocina
    LIVING = "living"  # sala, comedor, sala-comedor
    STUDY = "study"  # estudio
    CIRCULATION = "circulation"  # corredor, hall, pasillo
    PATIO = "patio"  # patio, terraza, balcón
    LAUNDRY = "laundry"  # ropas
    STORAGE = "storage"  # depósito, closet, alacena
    GARAGE = "garage"
    STAIRS = "stairs"  # punto fijo
    OTHER = "other"


class WallKind(StrEnum):
    UNKNOWN = "unknown"
    EXTERIOR = "exterior"  # fachada
    INTERIOR = "interior"  # muro interior / medianera
    PARTITION = "partition"  # tabique liviano


class OpeningOperation(StrEnum):
    """Cómo se abre una puerta o ventana."""

    SWING = "swing"  # batiente
    DOUBLE_SWING = "double_swing"
    SLIDING = "sliding"  # corrediza
    FOLDING = "folding"  # plegable
    FIXED = "fixed"  # ventana fija
    CASEMENT = "casement"  # ventana batiente
    NONE = "none"  # vano sin hoja


# ----------------------------------------------------------------------------- elementos


@dataclass(frozen=True, slots=True)
class Column:
    """Columna: rectangular (``width`` x ``depth``, girada ``rotation`` rad) o circular."""

    id: str
    center: Point2D
    width: float = 0.3
    depth: float = 0.3
    round: bool = False
    rotation: float = 0.0
    confidence: float = 1.0

    def __post_init__(self) -> None:
        if self.width <= 0 or self.depth <= 0:
            raise InvalidGeometryError(f"La columna {self.id} necesita medidas positivas")
        check_confidence(self.confidence)

    @property
    def area(self) -> float:
        if self.round:
            return math.pi * self.width * self.width / 4
        return self.width * self.depth

    def scaled(self, factor: float) -> Column:
        return replace(
            self,
            center=self.center.scaled(factor),
            width=self.width * factor,
            depth=self.depth * factor,
        )


#: catálogo: identificador en minúsculas, dígitos, "_" o "-" (p. ej. "cama_doble")
_CATALOG_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
#: material: mismo formato que el catálogo (p. ej. "madera_roble")
MATERIAL_ID = _CATALOG_ID


@dataclass(frozen=True, slots=True)
class Furniture:
    """Mueble del catálogo colocado en el plano (ADR-016).

    ``position`` es el centro de su huella; ``rotation`` en radianes; ``width`` x ``depth``
    es la huella y ``height`` la altura, en metros. La geometría la arma el cliente a partir
    de ``catalog_id``: el servidor solo guarda dónde está y qué tamaño tiene.
    """

    id: str
    catalog_id: str
    position: Point2D
    width: float
    depth: float
    height: float
    rotation: float = 0.0

    def __post_init__(self) -> None:
        if not _CATALOG_ID.match(self.catalog_id):
            raise InvalidGeometryError(f"Mueble {self.id}: catálogo inválido ({self.catalog_id!r})")
        if min(self.width, self.depth, self.height) <= 0:
            raise InvalidGeometryError(f"El mueble {self.id} necesita medidas positivas")
        if not math.isfinite(self.rotation):
            raise InvalidGeometryError(f"El mueble {self.id} tiene una rotación inválida")

    def scaled(self, factor: float) -> Furniture:
        """Al recalibrar la escala se mueve con el plano, pero conserva su tamaño real."""
        return replace(self, position=self.position.scaled(factor))


@dataclass(frozen=True, slots=True)
class Stair:
    """Tramo recto de escalera: línea de huella de ``start`` (abajo) a ``end`` (arriba)."""

    id: str
    start: Point2D
    end: Point2D
    width: float
    steps: int
    riser: float = 0.175
    to_level_id: str | None = None
    confidence: float = 1.0

    def __post_init__(self) -> None:
        if self.steps < 2:
            raise InvalidGeometryError(f"La escalera {self.id} necesita al menos 2 peldaños")
        if self.width <= 0 or self.riser <= 0:
            raise InvalidGeometryError(f"La escalera {self.id} necesita ancho y contrahuella")
        if self.run < 0.2:
            raise InvalidGeometryError(f"La escalera {self.id} es demasiado corta")
        check_confidence(self.confidence)

    @property
    def run(self) -> float:
        """Longitud en planta del tramo."""
        return self.start.distance_to(self.end)

    @property
    def tread(self) -> float:
        """Huella de cada peldaño."""
        return self.run / self.steps

    @property
    def rise(self) -> float:
        """Altura total que sube."""
        return self.riser * self.steps

    def scaled(self, factor: float) -> Stair:
        return replace(
            self,
            start=self.start.scaled(factor),
            end=self.end.scaled(factor),
            width=self.width * factor,
        )


class DimensionAxis(StrEnum):
    ALIGNED = "aligned"  # mide la distancia entre a y b
    HORIZONTAL = "horizontal"  # mide solo |Δx|
    VERTICAL = "vertical"  # mide solo |Δy|


@dataclass(frozen=True, slots=True)
class Dimension:
    """Cota del plano: dos puntos de referencia del modelo y el VALOR escrito en el plano.

    ``value`` es la verdad que dice el plano (metros) y no cambia al re-escalar; ``measured``
    es lo que mide hoy la geometría entre ``a`` y ``b``. ``residual`` = measured - value
    tras resolver las restricciones. ``offset`` (con signo) es dónde se dibuja la línea de
    cota respecto a ``a``-``b``; ``wall_ids`` son los muros que acota.
    """

    id: str
    a: Point2D
    b: Point2D
    value: float
    text: str = ""
    axis: DimensionAxis = DimensionAxis.ALIGNED
    offset: float = 0.0
    source: MeasureSource = MeasureSource.DIMENSION
    status: MeasureStatus = MeasureStatus.INFERRED
    confidence: float = 1.0
    residual: float | None = None
    wall_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not (self.value > 0 and math.isfinite(self.value)):
            raise InvalidGeometryError(f"La cota {self.id} debe tener un valor positivo")
        check_confidence(self.confidence)

    @property
    def measured(self) -> float:
        if self.axis is DimensionAxis.HORIZONTAL:
            return abs(self.b.x - self.a.x)
        if self.axis is DimensionAxis.VERTICAL:
            return abs(self.b.y - self.a.y)
        return self.a.distance_to(self.b)

    @property
    def deviation(self) -> float:
        """Diferencia actual entre la geometría y el valor escrito (metros)."""
        return self.measured - self.value

    def scaled(self, factor: float) -> Dimension:
        """Mueve la cota con la geometría; el VALOR leído del plano no cambia."""
        return replace(
            self, a=self.a.scaled(factor), b=self.b.scaled(factor), offset=self.offset * factor
        )


class LabelKind(StrEnum):
    ROOM_NAME = "room_name"
    AREA = "area"
    LEVEL = "level"  # N+0,00
    SCALE = "scale"  # ESC 1:50
    AXIS = "axis"  # eje A, B, 1, 2
    OTHER = "other"


@dataclass(frozen=True, slots=True)
class TextLabel:
    """Texto leído del plano, con su posición (para auditar y para el editor)."""

    id: str
    position: Point2D
    text: str
    kind: LabelKind = LabelKind.OTHER
    rotation: float = 0.0
    confidence: float = 1.0

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise InvalidGeometryError("Un texto del plano no puede estar vacío")
        check_confidence(self.confidence)

    def scaled(self, factor: float) -> TextLabel:
        return replace(self, position=self.position.scaled(factor))
