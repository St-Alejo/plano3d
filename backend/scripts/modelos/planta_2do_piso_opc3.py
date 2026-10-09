"""Modelo fiel de la lámina "PLANTA 2do PISO opc 3" (escala 1:50), levantado a mano de sus cotas.

Uso (con la API corriendo, p. ej. ``PLANO3D_MODE=memory uvicorn``)::

    python scripts/modelos/planta_2do_piso_opc3.py --api http://localhost:8000
    python scripts/modelos/planta_2do_piso_opc3.py --json salida.json   # solo el modelo

Con ``--api`` sube la foto de la lámina recortada a las esquinas del edificio (más un margen
para que se vean las cotas), espera a que termine la detección automática y la reemplaza por
este modelo, alineado con la foto rectificada: así el editor 2D y el visor 3D muestran el
plano original debajo del modelo.

Coordenadas en metros desde la esquina exterior superior izquierda (eje A / eje 4), x hacia
la derecha, y hacia abajo. Todas las medidas salen de las cotas de la lámina:

- Fachada 6,60 x 12,60; muros de 0,12 (``.12`` en las cotas interiores).
- Ejes A-B-C a 2,85 + 2,85 (+0,75 al borde); ejes 4-3-2-1 a 3,12 + 4,28 + 4,30 (+0,75).
  Columnas de 0,30 x 0,30 en cada cruce de ejes.
- Cotas interiores: escalera .18/.93/1.12/.90 y .16/.85/1.12/.85; cocina 3,11 x 3,00;
  alcoba 3 2,91 x (0,55 de clóset + 3,61); sala-comedor 3,33 x 4,28; baños de 1,20 de fondo;
  alcoba 2 2,84 x 3,64; clóset 0,55; alcoba 1 2,85 x 3,64.
- Vanos de fachada derecha: .92 / 2.20 / 1.30 / 2.20 / .90 / .70 / .63 / 1.20 / 2.56.
- Vanos de fachada inferior: .58 / 2.00 / 1.05 / 2.00 / .98.

Lo que la lámina no acota (anchos de puertas, muebles, ducto, ventana interior de la alcoba 3)
se midió sobre la foto rectificada (±5 cm). Alturas no dibujadas en planta: entrepiso 2,60 m,
puertas 2,00 m, ventanas con antepecho de 1,00 m (baño 1,50 m).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import httpx
import numpy as np
from PIL import Image

from plano3d.application.dto import model_from_dto, model_to_dto
from plano3d.domain import (
    BuildingModel,
    Column,
    Dimension,
    DimensionAxis,
    Furniture,
    LabelKind,
    Level,
    Measure,
    MeasureSource,
    MeasureStatus,
    Opening,
    OpeningKind,
    OpeningOperation,
    Point2D,
    Room,
    RoomType,
    Scale,
    SourceImage,
    Stair,
    TextLabel,
    Wall,
    WallKind,
)

PHOTO = Path(__file__).with_name("planta_2do_piso_opc3.jpg")
PROJECT_NAME = "Planta 2do piso opc 3"

ANCHO = 6.60
LARGO = 12.60
T = 0.12  # grosor de muro (cotas ".12")
H = 2.60  # entrepiso
PUERTA_H = 2.00

#: esquinas exteriores del edificio en la foto (px, ya girada): sup-izq, sup-der, inf-der, inf-izq
ESQUINAS_FOTO = ((316.5, 346.5), (1887.5, 406.0), (2005.5, 3412.5), (354.5, 3458.0))
#: margen alrededor del edificio que se conserva al rectificar (m): deja ver cotas y ejes
MARGEN = 0.6

EXACTA = Measure(MeasureStatus.EXACT, MeasureSource.DIMENSION, 0.01)
FOTO = Measure(MeasureStatus.INFERRED, MeasureSource.SCALE, 0.05)


def _p(x: float, y: float) -> Point2D:
    return Point2D(round(x, 4), round(y, 4))


def _puerta(i: str, desde: float, ancho: float, *, bisagra_final: bool, izquierda: bool) -> Opening:
    return Opening(
        id=f"o_{i}",
        kind=OpeningKind.DOOR,
        offset=round(desde, 4),
        width=ancho,
        height=PUERTA_H,
        operation=OpeningOperation.SWING,
        hinge_at_end=bisagra_final,
        opens_left=izquierda,
    )


def _ventana(i: str, desde: float, ancho: float, sill: float = 1.0, alto: float = 1.2) -> Opening:
    return Opening(
        id=f"o_{i}",
        kind=OpeningKind.WINDOW,
        offset=round(desde, 4),
        width=ancho,
        height=alto,
        sill=sill,
        operation=OpeningOperation.SLIDING,
    )


def _muro(
    i: str,
    a: tuple[float, float],
    b: tuple[float, float],
    *,
    kind: WallKind = WallKind.INTERIOR,
    openings: tuple[Opening, ...] = (),
    measure: Measure = EXACTA,
    thickness: float = T,
) -> Wall:
    return Wall(
        id=f"w_{i}",
        start=_p(*a),
        end=_p(*b),
        thickness=thickness,
        height=H,
        openings=openings,
        kind=kind,
        structural=kind == WallKind.EXTERIOR,
        measure=measure,
    )


def muros() -> tuple[Wall, ...]:
    e = T / 2  # eje de los muros de fachada
    x_esc = 3.25 + e  # muro escalera | cocina (.18 + .93 + 1.12 + .90 desde la cara interior)
    x_a3 = 0.12 + 2.91 + e  # alcoba 3 | sala (2,91 libres)
    x_b1 = 3.15 + 0.80 + e  # corredor | baño 1 (corredor de 0,80)
    y_3 = 3.12 + e  # escalera | alcoba 3 (3,00 libres desde la fachada)
    y_2 = 7.40 + e  # alcoba 3 | baños (0,55 + 3,61 libres)
    y_b = 8.72 + e  # baños | alcobas (1,20 libres)
    y_fin = 9.60 + e  # fin del corredor, frente a las puertas de las alcobas
    return (
        # ------------------------------------------------------------- fachadas
        _muro("fachada_sup", (e, e), (ANCHO - e, e), kind=WallKind.EXTERIOR),
        _muro(
            "fachada_der",
            (ANCHO - e, e),
            (ANCHO - e, LARGO - e),
            kind=WallKind.EXTERIOR,
            openings=(
                _ventana("v_cocina", 0.92 - e, 2.20),
                _ventana("v_sala", 4.42 - e, 2.20),
                _ventana("v_bano1", 7.52 - e, 0.70, sill=1.5, alto=0.6),
                _ventana("v_alcoba1", 8.85 - e, 1.20),
            ),
        ),
        _muro(
            "fachada_inf",
            (e, LARGO - e),
            (ANCHO - e, LARGO - e),
            kind=WallKind.EXTERIOR,
            openings=(
                _ventana("v_alcoba2", 0.58 - e, 2.00),
                _ventana("v_alcoba1_inf", 0.58 + 2.00 + 1.05 - e, 2.00),
            ),
        ),
        _muro("fachada_izq", (e, e), (e, LARGO - e), kind=WallKind.EXTERIOR),
        # ------------------------------------------------------------- interiores
        _muro(
            "escalera_cocina",
            (x_esc, e),
            (x_esc, y_3),
            openings=(
                # entrada del apartamento desde el punto fijo; abre hacia la cocina
                _puerta("entrada", 2.40 - e, 0.70, bisagra_final=False, izquierda=False),
            ),
        ),
        _muro("escalera_alcoba3", (e, y_3), (x_esc, y_3)),
        # remate del clóset de la alcoba 3 (0,55 de fondo)
        _muro("closet_alcoba3", (2.10 + e, y_3), (2.10 + e, 3.24 + 0.55), measure=FOTO),
        _muro(
            "alcoba3_sala",
            (x_a3, y_3),
            (x_a3, y_2),
            openings=(
                _puerta("alcoba3", 3.42 - y_3, 0.70, bisagra_final=False, izquierda=True),
                # ventana interior hacia la sala (la alcoba 3 da a la medianera)
                Opening(
                    id="o_v_alcoba3",
                    kind=OpeningKind.WINDOW,
                    offset=round(4.15 - y_3, 4),
                    width=2.50,
                    height=1.0,
                    sill=1.2,
                    operation=OpeningOperation.FIXED,
                    confidence=0.8,
                ),
            ),
        ),
        _muro(
            "alcoba3_bano2",
            (e, y_2),
            (x_a3, y_2),
            openings=(_puerta("bano2", 2.18 - e, 0.65, bisagra_final=True, izquierda=True),),
        ),
        _muro("sala_bano1", (x_b1, y_2), (ANCHO - e, y_2)),
        _muro(
            "corredor_izq",
            (x_a3, y_2),
            (x_a3, y_fin),
            openings=(_puerta("alcoba2", 8.86 - y_2, 0.70, bisagra_final=False, izquierda=True),),
        ),
        _muro(
            "corredor_der",
            (x_b1, y_2),
            (x_b1, y_fin),
            openings=(
                _puerta("bano1", 7.54 - y_2, 0.60, bisagra_final=False, izquierda=False),
                _puerta("alcoba1", 8.86 - y_2, 0.70, bisagra_final=False, izquierda=False),
            ),
        ),
        _muro("bano2_alcoba2", (e, y_b), (x_a3, y_b)),
        _muro("bano1_alcoba1", (x_b1, y_b), (ANCHO - e, y_b)),
        _muro("corredor_fin", (x_a3, y_fin), (x_b1, y_fin)),
        # clósets entre las alcobas 1 y 2 (0,55 + muro de 0,12 + clóset de 0,55)
        _muro("closets_sup", (3.51 + e, y_fin), (3.51 + e, 11.14)),
        _muro("closets_quiebre", (2.96 + e, 11.14), (3.51 + e, 11.14)),
        _muro("closets_inf", (2.96 + e, 11.14), (2.96 + e, LARGO - e)),
        # baño 2: muro del ducto con su ventana de ventilación
        _muro(
            "ducto",
            (0.575 + e, y_2),
            (0.575 + e, y_b),
            openings=(_ventana("v_ducto", 7.72 - y_2, 0.68, sill=1.0, alto=1.0),),
            measure=FOTO,
        ),
    )


def columnas() -> tuple[Column, ...]:
    ejes_x = {"A": 0.15, "B": 3.00, "C": 5.85}
    ejes_y = {"4": 0.15, "3": 3.27, "2": 7.55, "1": 11.85}
    return tuple(
        Column(id=f"c_{cx}{cy}", center=_p(x, y), width=0.30, depth=0.30)
        for cy, y in ejes_y.items()
        for cx, x in ejes_x.items()
    )


def escalera() -> tuple[Stair, ...]:
    """Escalera en U alrededor del vacío de 1,12 x 1,12; sube 2,60 m en 16 contrahuellas.

    Arranca en el descanso de llegada (franja de 0,90 junto a la entrada), va hacia la
    izquierda, sube por el tramo de 0,93 y vuelve por arriba. Las esquinas son peldaños
    compensados (las diagonales de la lámina).
    """
    r = H / 16
    vacio_x0, vacio_x1 = 1.23, 2.35  # .12 + .18 + .93 ; + 1.12
    vacio_y0, vacio_y1 = 1.13, 2.25  # .12 + .16 + .85 ; + 1.12
    izq = 0.30
    y_inf = (vacio_y1 + 3.12) / 2
    y_sup = (0.28 + vacio_y0) / 2
    x_izq = (izq + vacio_x0) / 2
    tramos = (
        ("s_1_inferior", (vacio_x1, y_inf), (vacio_x0, y_inf), 0.87, 4, 0),
        ("s_2_esquina", (vacio_x0, y_inf), (izq, y_inf), 0.87, 2, 4),
        ("s_3_izquierdo", (x_izq, vacio_y1), (x_izq, vacio_y0), 0.93, 4, 6),
        ("s_4_esquina", (x_izq, vacio_y0), (x_izq, 0.28), 0.93, 2, 10),
        ("s_5_superior", (vacio_x0, y_sup), (vacio_x1, y_sup), 0.85, 4, 12),
    )
    return tuple(
        Stair(
            id=i,
            start=_p(*a),
            end=_p(*b),
            width=w,
            steps=n,
            riser=r,
            base=round(antes * r, 4),
        )
        for i, a, b, w, n, antes in tramos
    )


def _rect(x0: float, y0: float, x1: float, y1: float) -> tuple[Point2D, ...]:
    return (_p(x0, y0), _p(x1, y0), _p(x1, y1), _p(x0, y1))


def ambientes() -> tuple[Room, ...]:
    return (
        Room(
            "r_punto_fijo",
            "Punto fijo",
            _rect(0.12, 0.12, 3.25, 3.12),
            room_type=RoomType.STAIRS,
            holes=(tuple(reversed(_rect(1.23, 1.13, 2.35, 2.25))),),
            floor_material="concreto",
        ),
        Room(
            "r_cocina",
            "Cocina",
            _rect(3.37, 0.12, 6.48, 3.12),
            room_type=RoomType.KITCHEN,
            floor_material="porcelanato",
        ),
        Room(
            "r_sala",
            "Sala-comedor",
            (
                _p(3.37, 3.12),
                _p(6.48, 3.12),
                _p(6.48, 7.40),
                _p(3.15, 7.40),
                _p(3.15, 3.24),
                _p(3.37, 3.24),
            ),
            room_type=RoomType.LIVING,
            floor_material="madera_roble",
        ),
        Room("r_alcoba3", "Alcoba 3", _rect(0.12, 3.24, 3.03, 7.40), room_type=RoomType.BEDROOM),
        Room("r_bano2", "Baño 2", _rect(0.70, 7.52, 3.03, 8.72), room_type=RoomType.BATHROOM),
        Room("r_bano1", "Baño 1", _rect(4.07, 7.52, 6.48, 8.72), room_type=RoomType.BATHROOM),
        Room(
            "r_corredor", "Corredor", _rect(3.15, 7.40, 3.95, 9.60), room_type=RoomType.CIRCULATION
        ),
        Room(
            "r_alcoba2",
            "Alcoba 2",
            (
                _p(0.12, 8.84),
                _p(3.03, 8.84),
                _p(3.03, 9.72),
                _p(3.51, 9.72),
                _p(3.51, 11.08),
                _p(2.96, 11.08),
                _p(2.96, 12.48),
                _p(0.12, 12.48),
            ),
            room_type=RoomType.BEDROOM,
        ),
        Room(
            "r_alcoba1",
            "Alcoba 1",
            (
                _p(4.07, 8.84),
                _p(6.48, 8.84),
                _p(6.48, 12.48),
                _p(3.08, 12.48),
                _p(3.08, 11.20),
                _p(3.63, 11.20),
                _p(3.63, 9.72),
                _p(4.07, 9.72),
            ),
            room_type=RoomType.BEDROOM,
        ),
    )


# rotaciones del catálogo: el frente del mueble mira hacia +y con 0
HACIA_ABAJO, HACIA_ARRIBA = 0.0, math.pi
HACIA_DERECHA, HACIA_IZQUIERDA = -math.pi / 2, math.pi / 2


def muebles() -> tuple[Furniture, ...]:
    def f(
        i: str, cat: str, x: float, y: float, w: float, d: float, h: float, rot: float
    ) -> Furniture:
        return Furniture(f"f_{i}", cat, _p(x, y), w, d, h, rot)

    return (
        # cocina en L: mesón superior (con el lavaplatos) y lateral (con la estufa)
        f("meson_sup", "cocina_lineal", 4.535, 0.42, 2.33, 0.60, 0.91, HACIA_ABAJO),
        f("meson_lat", "cocina_lineal", 3.67, 1.46, 1.48, 0.60, 0.91, HACIA_DERECHA),
        # comedor de 4 puestos (mesa cuadrada de 0,88)
        f("mesa", "mesa_centro", 4.99, 3.98, 0.88, 0.88, 0.75, 0.0),
        f("silla_n", "silla", 4.99, 3.30, 0.45, 0.50, 0.90, HACIA_ABAJO),
        f("silla_s", "silla", 4.99, 4.66, 0.45, 0.50, 0.90, HACIA_ARRIBA),
        f("silla_o", "silla", 4.31, 3.98, 0.45, 0.50, 0.90, HACIA_DERECHA),
        f("silla_e", "silla", 5.67, 3.98, 0.45, 0.50, 0.90, HACIA_IZQUIERDA),
        # sala en L contra la fachada y el muro del baño 1
        f("sofa", "sofa_3", 6.055, 6.26, 2.02, 0.85, 0.82, HACIA_IZQUIERDA),
        f("sofa_l", "sofa_2", 4.985, 7.00, 1.27, 0.80, 0.82, HACIA_ARRIBA),
        # alcobas: camas dobles con la cabecera contra el muro y clósets de 0,55
        f("cama_a3", "cama_doble", 1.275, 5.40, 1.40, 2.15, 1.0, HACIA_DERECHA),
        f("closet_a3", "closet", 1.11, 3.515, 1.98, 0.55, 2.2, HACIA_ABAJO),
        f("cama_a2", "cama_doble", 1.15, 10.92, 1.40, 1.90, 1.0, HACIA_DERECHA),
        f("closet_a2", "closet", 3.235, 10.40, 1.36, 0.55, 2.2, HACIA_IZQUIERDA),
        f("cama_a1", "cama_doble", 5.45, 10.895, 1.40, 1.90, 1.0, HACIA_IZQUIERDA),
        f("closet_a1", "closet", 3.39, 11.84, 1.28, 0.48, 2.2, HACIA_DERECHA),
        # baño 2: ducha junto al ducto, sanitario y lavamanos contra el muro de la alcoba 2
        f("ducha_b2", "ducha", 1.1125, 8.12, 1.20, 0.825, 2.0, HACIA_DERECHA),
        f("sanitario_b2", "sanitario", 1.95, 8.37, 0.40, 0.70, 0.78, HACIA_ARRIBA),
        f("lavamanos_b2", "lavamanos", 2.675, 8.495, 0.55, 0.45, 0.85, HACIA_ARRIBA),
        # baño 1: lavamanos, sanitario y ducha contra la fachada (ventana de 0,70)
        f("lavamanos_b1", "lavamanos", 4.345, 8.495, 0.55, 0.45, 0.85, HACIA_ARRIBA),
        f("sanitario_b1", "sanitario", 5.05, 8.37, 0.40, 0.70, 0.78, HACIA_ARRIBA),
        f("ducha_b1", "ducha", 5.99, 8.12, 1.20, 0.98, 2.0, HACIA_IZQUIERDA),
    )


def cotas() -> tuple[Dimension, ...]:
    def d(
        i: str,
        a: tuple[float, float],
        b: tuple[float, float],
        v: float,
        ax: DimensionAxis,
        off: float,
    ) -> Dimension:
        return Dimension(
            f"d_{i}",
            _p(*a),
            _p(*b),
            v,
            f"{v:.2f}".replace(".", ","),
            ax,
            off,
            status=MeasureStatus.EXACT,
        )

    hz, vt = DimensionAxis.HORIZONTAL, DimensionAxis.VERTICAL
    return (
        d("ancho", (0, 0), (ANCHO, 0), 6.60, hz, -0.9),
        d("largo", (ANCHO, 0), (ANCHO, LARGO), 12.60, vt, 0.9),
        d("cocina_x", (3.37, 1.50), (6.48, 1.50), 3.11, hz, 0),
        d("cocina_y", (5.20, 0.12), (5.20, 3.12), 3.00, vt, 0),
        d("alcoba3_x", (0.12, 6.80), (3.03, 6.80), 2.91, hz, 0),
        d("sala_x", (3.15, 6.00), (6.48, 6.00), 3.33, hz, 0),
        d("sala_y", (4.40, 3.12), (4.40, 7.40), 4.28, vt, 0),
        d("bano_y", (1.75, 7.52), (1.75, 8.72), 1.20, vt, 0),
        d("alcoba2_x", (0.12, 10.30), (2.96, 10.30), 2.84, hz, 0),
        d("alcoba2_y", (2.40, 8.84), (2.40, 12.48), 3.64, vt, 0),
        d("alcoba1_x", (3.63, 12.10), (6.48, 12.10), 2.85, hz, 0),
        d("alcoba1_y", (4.40, 8.84), (4.40, 12.48), 3.64, vt, 0),
    )


def rotulos() -> tuple[TextLabel, ...]:
    ejes = [("A", 0.15, -0.5), ("B", 3.00, -0.5), ("C", 5.85, -0.5)]
    filas = [("4", 0.15), ("3", 3.27), ("2", 7.55), ("1", 11.85)]
    return (
        TextLabel("t_ducto", _p(0.35, 8.12), "DUCTO", LabelKind.OTHER),
        TextLabel("t_escala", _p(0.0, 13.05), "ESCALA 1 - 50", LabelKind.SCALE),
        *(TextLabel(f"t_eje_{n}", _p(x, y), n, LabelKind.AXIS) for n, x, y in ejes),
        *(TextLabel(f"t_eje_{n}", _p(-0.5, y), n, LabelKind.AXIS) for n, y in filas),
    )


def build_model(project_id: str = "planta-2do-piso-opc3") -> BuildingModel:
    nivel = Level(
        id="l_piso2",
        name="2do piso",
        elevation=0.0,
        height=H,
        walls=muros(),
        rooms=ambientes(),
        columns=columnas(),
        stairs=escalera(),
        dimensions=cotas(),
        labels=rotulos(),
        furniture=muebles(),
    )
    return BuildingModel(
        project_id=project_id, scale=Scale(0.01, "dimensions", 1.0), levels=(nivel,)
    )


# ----------------------------------------------------------------------------- foto y API


def _homografia() -> np.ndarray:
    """De metros (edificio) a píxeles de la foto, por las cuatro esquinas exteriores."""
    src = np.array([(0, 0), (ANCHO, 0), (ANCHO, LARGO), (0, LARGO)], dtype=np.float32)
    dst = np.array(ESQUINAS_FOTO, dtype=np.float32)
    return np.asarray(cv2.getPerspectiveTransform(src, dst), dtype=np.float64)


def esquinas_recorte(margen: float = MARGEN) -> list[list[float]]:
    """Esquinas (normalizadas 0..1) del rectángulo edificio + margen dentro de la foto."""
    h = _homografia()
    with Image.open(PHOTO) as im:
        w_px, h_px = im.size
    out = []
    for x, y in (
        (-margen, -margen),
        (ANCHO + margen, -margen),
        (ANCHO + margen, LARGO + margen),
        (-margen, LARGO + margen),
    ):
        u, v, s = h @ np.array([x, y, 1.0])
        out.append([round(float(u / s) / w_px, 5), round(float(v / s) / h_px, 5)])
    return out


def aligned_model(project_id: str, source: SourceImage, margen: float = MARGEN) -> BuildingModel:
    """El modelo puesto sobre la foto rectificada (que cubre edificio + margen).

    La rectificación no conserva exacta la proporción de la hoja (papel curvado: ~1 %), así
    que la escala es el promedio de la horizontal y la vertical y el modelo va centrado: el
    desfase con la foto queda repartido en los dos bordes.
    """
    base = build_model(project_id)
    mpp_x = (ANCHO + 2 * margen) / source.width_px
    mpp_y = (LARGO + 2 * margen) / source.height_px
    mpp = (mpp_x + mpp_y) / 2
    dx = (source.width_px * mpp - ANCHO) / 2
    dy = (source.height_px * mpp - LARGO) / 2
    return BuildingModel(
        project_id=project_id,
        scale=Scale(mpp, "dimensions", 1.0),
        levels=tuple(lv.translated(dx, dy) for lv in base.levels),
        source_image=source,
    )


def upload(
    api: str, name: str = PROJECT_NAME, project_id: str | None = None, timeout: float = 300.0
) -> str:
    """Crea el proyecto con la foto (o reusa ``project_id``) y le pone este modelo."""
    with httpx.Client(base_url=api.rstrip("/"), timeout=120) as http:
        if project_id is None:
            with PHOTO.open("rb") as fh:
                r = http.post(
                    "/api/projects",
                    files={"file": (PHOTO.name, fh, "image/jpeg")},
                    data={"name": name, "corners": json.dumps(esquinas_recorte())},
                )
            r.raise_for_status()
            project_id = str(r.json()["id"])
        r = _wait_ready(http, project_id, timeout)
        body = r.json()
        src = (body.get("model") or {}).get("source_image")
        if not src:
            raise RuntimeError(f"La detección no dejó imagen rectificada ({body['status']})")
        model = aligned_model(
            project_id, SourceImage(src["key"], src["width_px"], src["height_px"])
        )
        r = http.put(
            f"/api/projects/{project_id}/model",
            params={"summary": "Modelo fiel desde las cotas de la lámina"},
            headers={"If-Match": r.headers.get("ETag", "*"), "Content-Type": "application/json"},
            content=model_to_dto(model).model_dump_json(),
        )
        r.raise_for_status()
        return project_id


def _wait_ready(http: httpx.Client, project_id: str, timeout: float) -> httpx.Response:
    """Espera a que termine la detección. Mientras analiza, el servidor puede no responder."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        try:
            r = http.get(f"/api/projects/{project_id}")
        except httpx.TransportError:
            time.sleep(2.0)
            continue
        r.raise_for_status()
        if r.json()["status"] in ("ready", "failed"):
            return r
        time.sleep(1.0)
    raise TimeoutError(f"El proyecto {project_id} no terminó en {timeout:.0f} s")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", help="URL de la API (p. ej. http://localhost:8000)")
    ap.add_argument("--json", type=Path, help="escribe el modelo (contrato BuildingModelDTO)")
    ap.add_argument("--proyecto", help="con --api: reemplaza el modelo de un proyecto ya subido")
    args = ap.parse_args(argv)
    if not args.api and not args.json:
        ap.error("indica --api o --json")
    if args.json:
        dto = model_to_dto(build_model())
        model_from_dto(dto)  # el contrato lo vuelve a leer igual
        args.json.write_text(dto.model_dump_json(indent=2), encoding="utf-8")
        print(f"Modelo escrito en {args.json}")
    if args.api:
        pid = upload(args.api, project_id=args.proyecto)
        print(f"Proyecto {pid} listo: ábrelo en la app en /p/{pid} (3D en /p/{pid}/3d)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
