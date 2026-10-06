from dataclasses import replace

import pytest

from plano3d.domain import BuildingModel, Level, Opening, OpeningKind, Point2D, Room, Scale, Wall
from plano3d.domain.quality import correction_stats


def wall(
    id: str, x1: float, y1: float, x2: float, y2: float, ops: tuple[Opening, ...] = ()
) -> Wall:
    return Wall(id, Point2D(x1, y1), Point2D(x2, y2), openings=ops)


def door(offset: float) -> Opening:
    return Opening("d", OpeningKind.DOOR, offset, 0.9, 2.1)


def room(label: str) -> Room:
    return Room("r1", label, (Point2D(0, 0), Point2D(4, 0), Point2D(4, 3), Point2D(0, 3)))


def model(walls: tuple[Wall, ...], rooms: tuple[Room, ...] = ()) -> BuildingModel:
    return BuildingModel("p", Scale(0.01), (Level("l0", "PB", walls=walls, rooms=rooms),))


BASE = (
    wall("a", 0, 0, 4, 0, (door(1),)),
    wall("b", 4, 0, 4, 3),
    wall("c", 4, 3, 0, 3),
    wall("d", 0, 3, 0, 0),
)


def test_identical_models_need_no_correction() -> None:
    s = correction_stats(model(BASE), model(BASE))
    assert s.walls_unchanged == 4 and s.correction_rate == 0


def test_wall_drawn_in_opposite_direction_is_the_same_wall() -> None:
    flipped = (wall("x", 4, 0, 0, 0), *BASE[1:])
    assert correction_stats(model(BASE), model(flipped)).walls_moved == 0


def test_counts_moved_added_deleted() -> None:
    final = (
        wall("a", 0, 0.1, 4, 0.1, (door(1),)),  # movido 10 cm
        BASE[1],
        BASE[2],
        # "d" borrado; uno nuevo lejos
        wall("n", 2, 0, 2, 3),
    )
    s = correction_stats(model(BASE), model(final))
    assert (s.walls_moved, s.walls_deleted, s.walls_added) == (1, 1, 1)
    assert s.correction_rate == pytest.approx(3 / 4)


def test_openings_and_room_labels() -> None:
    win = replace(door(1), kind=OpeningKind.WINDOW, height=1.2, sill=0.9)
    final = (wall("a", 0, 0, 4, 0, (win,)), BASE[1], wall("c", 4, 3, 0, 3, (door(2),)), BASE[3])
    s = correction_stats(model(BASE, (room("Espacio 1"),)), model(final, (room("Cocina"),)))
    assert s.openings_kind_changed == 1
    assert s.openings_added == 1 and s.openings_deleted == 0
    assert s.rooms_relabeled == 1
    assert s.area_final_m2 == pytest.approx(12)
