"""Marcas del plano que no son edificio: columnas falsas y grupos de muros sueltos."""

from plano3d.domain import Column, Level, Point2D, Wall
from plano3d.infrastructure.cv.context import Segment
from plano3d.infrastructure.cv.multilevel import with_parapets
from plano3d.infrastructure.cv.stages.topology import drop_stray_groups
from plano3d.infrastructure.vector.walls import ColumnCand, WallCand, plausible_columns

# casa de 10 x 8 (unidades del dibujo) con muros de espesor 0,2
BOX = [
    WallCand(0, 0, 10, 0, 0.2),
    WallCand(10, 0, 10, 8, 0.2),
    WallCand(10, 8, 0, 8, 0.2),
    WallCand(0, 8, 0, 0, 0.2),
]


def _col(x: float, y: float, size: float = 0.3) -> ColumnCand:
    return ColumnCand((x, y), size, size, False, 0.0)


def test_columna_en_muro_y_exenta_se_conservan() -> None:
    kept = plausible_columns([_col(10, 4), _col(5, 4)], BOX)
    assert [c.center for c in kept] == [(10, 4), (5, 4)]


def test_marcas_en_fila_y_fuera_del_edificio_se_descartan() -> None:
    # fila de marcas de cota sobre el plano y otra dentro, muy juntas entre sí
    row = [_col(2 + 0.4 * i, -1.0, 0.17) for i in range(6)]
    inside = [_col(4, 4, 0.17), _col(4.4, 4, 0.17)]
    assert plausible_columns([*row, *inside], BOX) == []


def test_azotea_sin_pilares_exentos() -> None:
    walls = (
        Wall("a", Point2D(0, 0), Point2D(10, 0)),
        Wall("b", Point2D(10, 0), Point2D(10, 8)),
        Wall("c", Point2D(10, 8), Point2D(0, 8)),
        Wall("d", Point2D(0, 8), Point2D(0, 0)),
    )
    cols = (Column("en_muro", Point2D(10, 4), 0.3, 0.3), Column("exenta", Point2D(5, 4), 0.3, 0.3))
    roof = with_parapets(Level("l", "Azotea", walls=walls, columns=cols))
    assert [c.id for c in roof.columns] == ["en_muro"]


def test_grupo_de_muros_suelto_se_descarta() -> None:
    house = [
        Segment(0, 0, 400, 0, 10),
        Segment(400, 0, 400, 300, 10),
        Segment(400, 300, 0, 300, 10),
        Segment(0, 300, 0, 0, 10),
    ]
    stray_l = [Segment(600, 500, 640, 500, 10), Segment(640, 500, 640, 540, 10)]
    shed = [Segment(700, 0, 900, 0, 10), Segment(900, 0, 900, 200, 10)]  # 400 px: se queda
    out = drop_stray_groups([*house, *stray_l, *shed])
    assert len(out) == len(house) + len(shed)
