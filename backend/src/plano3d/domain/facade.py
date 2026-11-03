"""Fachada paramétrica: un estilo base más lo que la persona (o la IA) le cambia.

El estilo (``FACADE_STYLES``) trae el revestimiento de cada parte, los colores y los
detalles; ``FacadeCustom`` guarda solo lo que se cambió encima. Así "pon madera en el
segundo piso" o "quita la jardinera" no obligan a elegir otro estilo, y volver a un estilo
limpio es dejar la personalización vacía. Nada de esto toca el interior.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from plano3d.domain.errors import InvalidGeometryError

#: revestimientos que el visor sabe pintar (cada uno con su foto PBR)
FACADE_MATERIALS = ("panete", "concreto", "ladrillo", "madera", "porcelanato")
#: partes de la fachada: piso 1, pisos de arriba, frente de los pisos de arriba y portón
FACADE_PARTS = ("ground", "upper", "front", "gate")
#: colores lisos: perfilería de ventanas, franja de losa, marco saliente y listones
FACADE_COLORS = ("frame", "band", "accent")
#: detalles que se pueden poner o quitar
FACADE_FEATURES = ("listones", "jardinera", "marco_ventana", "alero", "luces")

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _check_color(name: str, value: str | None) -> None:
    if value is not None and not _HEX.match(value):
        raise InvalidGeometryError(f"Color de {name} inválido ({value!r}; usa #rrggbb)")


@dataclass(frozen=True, slots=True)
class FacadeSurface:
    """Revestimiento de una parte; lo que quede en None se toma del estilo."""

    material: str | None = None
    color: str | None = None

    def __post_init__(self) -> None:
        if self.material is not None and self.material not in FACADE_MATERIALS:
            raise InvalidGeometryError(
                f"Revestimiento {self.material!r} desconocido (usa {', '.join(FACADE_MATERIALS)})"
            )
        _check_color("revestimiento", self.color)


@dataclass(frozen=True, slots=True)
class FacadeCustom:
    ground: FacadeSurface | None = None
    upper: FacadeSurface | None = None
    front: FacadeSurface | None = None
    gate: FacadeSurface | None = None
    frame: str | None = None
    band: str | None = None
    accent: str | None = None
    #: detalles a la vista; None = los del estilo
    features: tuple[str, ...] | None = None

    def __post_init__(self) -> None:
        for name in FACADE_COLORS:
            _check_color(name, getattr(self, name))
        if self.features is not None:
            unknown = [f for f in self.features if f not in FACADE_FEATURES]
            if unknown:
                raise InvalidGeometryError(
                    f"Detalle de fachada desconocido: {', '.join(unknown)} "
                    f"(usa {', '.join(FACADE_FEATURES)})"
                )
            if len(set(self.features)) != len(self.features):
                raise InvalidGeometryError("Un detalle de fachada está repetido")

    @property
    def is_empty(self) -> bool:
        return self == FacadeCustom()
