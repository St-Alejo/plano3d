"""Modelo v2 (ADR-012): muros curvos, procedencia de medidas, columnas, escaleras y cotas."""

import json
import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.domain import (
    MODEL_SCHEMA_VERSION,
    Arc,
    BuildingModel,
    Column,
    Dimension,
    DimensionAxis,
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
    Stair,
    TextLabel,
    Wall,
    WallKind,
)
from plano3d.domain.errors import InvalidGeometryError, OpeningDoesNotFitError


def curved(bulge: float = 1.0) -> Wall:
    return Wall(id="wc", start=Point2D(0, 0), end=Point2D(4, 0), bulge=bulge, thickness=0.2)


class TestArc:
    def test_semicircle(self) -> None:
        a = Arc(Point2D(0, 0), Point2D(4, 0), 2.0)
        assert a.radius == pytest.approx(2.0)
        assert a.length == pytest.approx(2 * math.pi)
        mid = a.point_at(a.length / 2)
        # flecha positiva = normal izquierda de (1,0) en imagen = (0, 1)... (-dy, dx) = (0, 1)
        assert (mid.x, mid.y) == pytest.approx((2.0, 2.0), abs=1e-9)

    def test_rejects_more_than_half_circle(self) -> None:
        with pytest.raises(ValueError):
            Arc(Point2D(0, 0), Point2D(4, 0), 2.5)

    @given(st.floats(0.05, 1.99), st.booleans())
    def test_ends_and_sagitta(self, s: float, left: bool) -> None:
        b = s if left else -s
        a = Arc(Point2D(0, 0), Point2D(4, 0), b)
        assert (a.point_at(0).x, a.point_at(0).y) == pytest.approx((0, 0), abs=1e-6)
        end = a.point_at(a.length)
        assert (end.x, end.y) == pytest.approx((4, 0), abs=1e-6)
        assert a.point_at(a.length / 2).y == pytest.approx(b, abs=1e-6)
        assert a.length > a.chord


class TestCurvedWall:
    def test_length_follows_the_arc(self) -> None:
        w = curved(1.0)
        assert w.is_curved
        assert w.chord == pytest.approx(4.0)
        assert w.length == pytest.approx(Arc(w.start, w.end, 1.0).length)

    def test_openings_fit_along_the_arc(self) -> None:
        # 4,6 m de arco: una ventana entre 4,1 y 4,5 m cabe aunque la cuerda mida 4
        op = Opening(id="o", kind=OpeningKind.WINDOW, offset=4.1, width=0.4, height=1, sill=1)
        assert curved(1.0).with_opening(op).length > 4.5
        with pytest.raises(OpeningDoesNotFitError):
            curved(0.2).with_opening(op)

    def test_invalid_bulge(self) -> None:
        with pytest.raises(InvalidGeometryError):
            curved(3.0)

    def test_scaling_scales_the_bulge(self) -> None:
        w = curved(1.0).scaled(2.0)
        assert w.bulge == pytest.approx(2.0)
        assert w.length == pytest.approx(2 * curved(1.0).length)

    def test_defaults_are_v1_compatible(self) -> None:
        w = Wall(id="w", start=Point2D(0, 0), end=Point2D(3, 0))
        assert w.kind is WallKind.UNKNOWN
        assert w.measure.status is MeasureStatus.INFERRED
        assert w.measure.source is MeasureSource.SCALE


class TestRoomV2:
    def test_holes_reduce_area(self) -> None:
        outer = (Point2D(0, 0), Point2D(10, 0), Point2D(10, 10), Point2D(0, 10))
        hole = (Point2D(4, 4), Point2D(6, 4), Point2D(6, 6), Point2D(4, 6))
        r = Room(id="r", label="patio", polygon=outer, holes=(hole,), declared_area=96.5)
        assert r.area == pytest.approx(96.0)
        assert r.area_deviation == pytest.approx(-0.5)
        assert r.scaled(0.5).area == pytest.approx(24.0)

    def test_hole_outside_is_invalid(self) -> None:
        outer = (Point2D(0, 0), Point2D(1, 0), Point2D(1, 1), Point2D(0, 1))
        hole = (Point2D(4, 4), Point2D(6, 4), Point2D(6, 6))
        with pytest.raises(InvalidGeometryError):
            Room(id="r", label="x", polygon=outer, holes=(hole,))


class TestElements:
    def test_dimension_value_survives_rescaling(self) -> None:
        d = Dimension(id="d", a=Point2D(0, 0), b=Point2D(3, 4), value=5.0, text="5,00")
        assert d.measured == pytest.approx(5.0)
        d2 = d.scaled(2)
        assert d2.value == 5.0  # lo que dice el plano no cambia
        assert d2.deviation == pytest.approx(5.0)

    def test_dimension_axes(self) -> None:
        a, b = Point2D(0, 0), Point2D(3, 4)
        assert Dimension("h", a, b, 3, axis=DimensionAxis.HORIZONTAL).measured == 3
        assert Dimension("v", a, b, 4, axis=DimensionAxis.VERTICAL).measured == 4

    def test_dimension_needs_positive_value(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Dimension("d", Point2D(0, 0), Point2D(1, 0), 0.0)

    def test_stair_derived_values(self) -> None:
        s = Stair(id="s", start=Point2D(0, 0), end=Point2D(3.0, 0), width=1.0, steps=12)
        assert s.tread == pytest.approx(0.25)
        assert s.rise == pytest.approx(2.1)
        with pytest.raises(InvalidGeometryError):
            Stair(id="s", start=Point2D(0, 0), end=Point2D(3, 0), width=1.0, steps=1)

    def test_column(self) -> None:
        assert Column("c", Point2D(0, 0), 0.4, 0.4, round=True).area == pytest.approx(
            math.pi * 0.04
        )
        with pytest.raises(InvalidGeometryError):
            Column("c", Point2D(0, 0), 0.0)

    def test_measure_error_non_negative(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Measure(error=-0.01)

    def test_label_not_empty(self) -> None:
        with pytest.raises(InvalidGeometryError):
            TextLabel("t", Point2D(0, 0), "  ")


def full_model() -> BuildingModel:
    wall = Wall(
        id="w1",
        start=Point2D(0, 0),
        end=Point2D(5, 0),
        bulge=0.5,
        kind=WallKind.EXTERIOR,
        structural=True,
        measure=Measure(MeasureStatus.EXACT, MeasureSource.DIMENSION, 0.005, "d1"),
        openings=(
            Opening(
                id="o1",
                kind=OpeningKind.DOOR,
                offset=1.0,
                width=0.9,
                height=2.1,
                operation=OpeningOperation.SLIDING,
                hinge_at_end=True,
                opens_left=False,
            ),
        ),
    )
    room = Room(
        id="r1",
        label="ALCOBA",
        polygon=(Point2D(0, 0), Point2D(5, 0), Point2D(5, 4), Point2D(0, 4)),
        room_type=RoomType.BEDROOM,
        declared_area=20.0,
    )
    level = Level(
        id="l0",
        name="Planta 1",
        height=2.8,
        walls=(wall,),
        rooms=(room,),
        columns=(Column("c1", Point2D(2, 2), 0.3, 0.4, rotation=0.1),),
        stairs=(Stair("s1", Point2D(1, 1), Point2D(4, 1), 1.0, 14, 0.18, "l1"),),
        dimensions=(
            Dimension(
                "d1",
                Point2D(0, 0),
                Point2D(5, 0),
                5.0,
                "5,00",
                DimensionAxis.HORIZONTAL,
                -0.8,
                status=MeasureStatus.EXACT,
                residual=0.001,
                wall_ids=("w1",),
            ),
        ),
        labels=(TextLabel("t1", Point2D(2, 2), "N+2,80", LabelKind.LEVEL),),
    )
    return BuildingModel(project_id="p", scale=Scale(0.01, "dimensions", 0.9), levels=(level,))


class TestContractV2:
    def test_roundtrip_keeps_every_v2_field(self) -> None:
        m = full_model()
        dto = model_to_dto(m)
        again = model_from_dto(BuildingModelDTO.model_validate_json(dto.model_dump_json()))
        assert again == m
        lv = dto.levels[0]
        assert lv.dimensions and lv.dimensions[0].measured == pytest.approx(5.0)
        assert lv.stairs and lv.stairs[0].tread == pytest.approx(3 / 14)
        assert dto.schema_version == MODEL_SCHEMA_VERSION

    def test_v1_json_is_upgraded(self) -> None:
        """Un modelo guardado antes de la v2 (sin campos nuevos) se lee y queda en v2."""
        v1 = {
            "project_id": "p",
            "scale": {"meters_per_pixel": 0.01, "source": "estimated", "confidence": 0.3},
            "levels": [
                {
                    "id": "l0",
                    "name": "Planta baja",
                    "elevation": 0,
                    "walls": [
                        {
                            "id": "w",
                            "start": {"x": 0, "y": 0},
                            "end": {"x": 4, "y": 0},
                            "openings": [
                                {"id": "o", "kind": "door", "offset": 1, "width": 0.9, "height": 2}
                            ],
                        }
                    ],
                    "rooms": [],
                }
            ],
        }
        m = model_from_dto(BuildingModelDTO.model_validate_json(json.dumps(v1)))
        assert m.schema_version == MODEL_SCHEMA_VERSION
        w = m.levels[0].walls[0]
        assert not w.is_curved and w.kind is WallKind.UNKNOWN
        assert w.openings[0].operation is None and w.openings[0].opens_left
        assert m.levels[0].height == 2.6 and m.levels[0].dimensions == ()

    def test_recalibration_keeps_dimension_values(self) -> None:
        m = full_model().recalibrated(0.02)
        d = m.levels[0].dimensions[0]
        assert d.value == 5.0
        assert d.measured == pytest.approx(10.0)
        assert m.levels[0].rooms[0].declared_area == 20.0

    def test_unsupported_schema_version(self) -> None:
        with pytest.raises(InvalidGeometryError):
            BuildingModel(project_id="p", scale=Scale(0.01), schema_version=99)

    def test_duplicate_dimension_ids(self) -> None:
        d = Dimension("d", Point2D(0, 0), Point2D(1, 0), 1.0)
        with pytest.raises(InvalidGeometryError):
            Level(id="l", name="x", dimensions=(d, d))

    def test_with_dimension_replaces(self) -> None:
        lv = full_model().levels[0]
        d = lv.dimension("d1")
        lv2 = lv.with_dimension(Dimension(d.id, d.a, d.b, 5.05, "5,05"))
        assert len(lv2.dimensions) == 1 and lv2.dimension("d1").value == 5.05
