import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from plano3d.domain import (
    BuildingModel,
    Level,
    Opening,
    OpeningKind,
    Point2D,
    Room,
    Scale,
    Wall,
)
from plano3d.domain.errors import (
    EntityNotFoundError,
    InvalidGeometryError,
    OpeningDoesNotFitError,
)
from plano3d.domain.geometry import polygon_area, polygon_centroid


def wall(length: float = 4.0, **kw: object) -> Wall:
    return Wall(id=str(kw.pop("id", "w1")), start=Point2D(0, 0), end=Point2D(length, 0), **kw)  # type: ignore[arg-type]


def door(offset: float, width: float = 0.9, id: str = "o1") -> Opening:
    return Opening(id=id, kind=OpeningKind.DOOR, offset=offset, width=width, height=2.1)


def square(side: float, x: float = 0, y: float = 0, id: str = "r1") -> Room:
    pts = (Point2D(x, y), Point2D(x + side, y), Point2D(x + side, y + side), Point2D(x, y + side))
    return Room(id=id, label="sala", polygon=pts, confidence=0.9)


class TestPoint2D:
    def test_rejects_non_finite(self) -> None:
        with pytest.raises(ValueError):
            Point2D(math.nan, 0)

    def test_distance(self) -> None:
        assert Point2D(0, 0).distance_to(Point2D(3, 4)) == pytest.approx(5)


class TestWall:
    def test_length_is_derived(self) -> None:
        assert wall(4.0).length == pytest.approx(4.0)

    def test_rejects_zero_length(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Wall(id="w", start=Point2D(1, 1), end=Point2D(1, 1))

    def test_rejects_non_positive_thickness(self) -> None:
        with pytest.raises(InvalidGeometryError):
            wall(thickness=0)

    def test_opening_must_fit_in_length(self) -> None:
        with pytest.raises(OpeningDoesNotFitError):
            wall(2.0, openings=(door(offset=1.5, width=0.9),))

    def test_opening_must_fit_in_height(self) -> None:
        tall = Opening(id="o", kind=OpeningKind.WINDOW, offset=0, width=1, height=2, sill=1.0)
        with pytest.raises(OpeningDoesNotFitError):
            wall(height=2.6, openings=(tall,))

    def test_openings_cannot_overlap(self) -> None:
        with pytest.raises(OpeningDoesNotFitError):
            wall(openings=(door(0.5, id="a"), door(1.0, id="b")))

    def test_adjacent_openings_are_allowed(self) -> None:
        w = wall(openings=(door(0.5, 1.0, id="a"), door(1.5, 1.0, id="b")))
        assert len(w.openings) == 2

    def test_is_immutable_and_with_opening_returns_copy(self) -> None:
        original = wall()
        updated = original.with_opening(door(1.0))
        assert original.openings == ()
        assert len(updated.openings) == 1

    def test_without_unknown_opening_fails(self) -> None:
        with pytest.raises(EntityNotFoundError):
            wall().without_opening("nope")

    def test_point_at_midpoint(self) -> None:
        assert wall(4).point_at(2) == Point2D(2, 0)

    @given(
        length=st.floats(0.5, 50),
        rel_offset=st.floats(0, 1),
        rel_width=st.floats(0.01, 1),
    )
    def test_accepted_openings_never_exceed_wall(
        self, length: float, rel_offset: float, rel_width: float
    ) -> None:
        width = rel_width * length
        offset = rel_offset * length
        try:
            w = wall(length, openings=(door(offset, width),))
        except OpeningDoesNotFitError:
            assert offset + width > length
        else:
            assert all(o.end <= w.length + 1e-6 for o in w.openings)

    @given(factor=st.floats(0.1, 10))
    def test_scaling_keeps_openings_inside(self, factor: float) -> None:
        w = wall(4, openings=(door(3.0, 1.0),)).scaled(factor)
        assert w.length == pytest.approx(4 * factor)
        assert w.openings[0].end <= w.length + 1e-6
        assert w.openings[0].height == 2.1  # la altura no escala


class TestRoom:
    def test_area_and_centroid(self) -> None:
        r = square(4)
        assert r.area == pytest.approx(16)
        assert r.centroid == Point2D(2, 2)

    def test_rejects_self_intersecting_polygon(self) -> None:
        bowtie = (Point2D(0, 0), Point2D(1, 1), Point2D(1, 0), Point2D(0, 1))
        with pytest.raises(InvalidGeometryError):
            Room(id="r", label="x", polygon=bowtie)

    def test_rejects_invalid_confidence(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Room(id="r", label="x", polygon=square(1).polygon, confidence=1.5)

    @given(
        side=st.floats(0.5, 30),
        dx=st.floats(-100, 100),
        dy=st.floats(-100, 100),
    )
    def test_area_invariant_under_translation(self, side: float, dx: float, dy: float) -> None:
        pts = square(side).polygon
        moved = tuple(p.translated(dx, dy) for p in pts)
        assert polygon_area(moved) == pytest.approx(polygon_area(pts), rel=1e-6)

    @given(side=st.floats(0.5, 30), factor=st.floats(0.1, 10))
    def test_area_scales_quadratically(self, side: float, factor: float) -> None:
        assert square(side).scaled(factor).area == pytest.approx(side**2 * factor**2, rel=1e-6)


class TestGeometryHelpers:
    def test_degenerate_polygon(self) -> None:
        pts = (Point2D(0, 0), Point2D(1, 0))
        assert polygon_area(pts) == 0
        line = (Point2D(0, 0), Point2D(1, 0), Point2D(2, 0))
        assert polygon_centroid(line) == Point2D(1, 0)


class TestLevel:
    def test_rejects_overlapping_rooms(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Level(id="l", name="PB", rooms=(square(4, id="a"), square(4, 1, 1, id="b")))

    def test_rooms_sharing_an_edge_are_fine(self) -> None:
        lv = Level(id="l", name="PB", rooms=(square(4, id="a"), square(4, 4, 0, id="b")))
        assert lv.total_area == pytest.approx(32)

    def test_rejects_duplicate_wall_ids(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Level(id="l", name="PB", walls=(wall(id="x"), wall(id="x")))

    def test_with_wall_adds_then_replaces(self) -> None:
        lv = Level(id="l", name="PB").with_wall(wall(4))
        lv = lv.with_wall(wall(6))
        assert len(lv.walls) == 1 and lv.wall("w1").length == pytest.approx(6)

    def test_without_wall(self) -> None:
        lv = Level(id="l", name="PB", walls=(wall(),)).without_wall("w1")
        assert lv.walls == ()
        with pytest.raises(EntityNotFoundError):
            lv.without_wall("w1")

    def test_room_lookup_and_relabel(self) -> None:
        lv = Level(id="l", name="PB", rooms=(square(3),))
        lv = lv.with_room(lv.room("r1").relabeled("cocina"))
        assert lv.room("r1").label == "cocina"
        with pytest.raises(EntityNotFoundError):
            lv.room("zz")


class TestBuildingModel:
    def model(self) -> BuildingModel:
        lv = Level(id="l0", name="PB", walls=(wall(4, openings=(door(1),)),), rooms=(square(4),))
        return BuildingModel(project_id="p", scale=Scale(0.01), levels=(lv,))

    def test_recalibration_rescales_geometry(self) -> None:
        m = self.model().recalibrated(0.02)  # el doble de metros por píxel
        assert m.scale.source == "calibrated"
        assert m.total_area == pytest.approx(64)
        w = m.level("l0").wall("w1")
        assert w.length == pytest.approx(8)
        assert w.height == pytest.approx(2.6)
        assert w.openings[0].width == pytest.approx(1.8)

    def test_with_level_and_missing_level(self) -> None:
        m = self.model().with_level(Level(id="l1", name="P1", elevation=2.8))
        assert len(m.levels) == 2
        with pytest.raises(EntityNotFoundError):
            m.level("nope")

    def test_scale_must_be_positive(self) -> None:
        with pytest.raises(InvalidGeometryError):
            Scale(0)
