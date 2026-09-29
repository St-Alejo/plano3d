from hypothesis import given
from hypothesis import strategies as st

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.domain import (
    BuildingModel,
    Level,
    Opening,
    OpeningKind,
    Point2D,
    Room,
    Scale,
    SourceImage,
    Wall,
)


@st.composite
def models(draw: st.DrawFn) -> BuildingModel:
    n = draw(st.integers(1, 4))
    walls = []
    for i in range(n):
        length = draw(st.floats(1.5, 20))
        ops = ()
        if draw(st.booleans()):
            ops = (Opening(f"o{i}", OpeningKind.WINDOW, 0.2, 1.0, 1.2, 0.9, 0.7),)
        walls.append(Wall(f"w{i}", Point2D(0, i * 3.0), Point2D(length, i * 3.0), openings=ops))
    side = draw(st.floats(1, 10))
    room = Room(
        "r", "sala", (Point2D(0, 0), Point2D(side, 0), Point2D(side, side), Point2D(0, side)), 0.8
    )
    return BuildingModel(
        "p",
        Scale(draw(st.floats(0.001, 0.1)), "estimated", 0.4),
        (Level("l0", "PB", 0.0, tuple(walls), (room,)),),
        SourceImage("rectified/p.png", 800, 600),
    )


@given(models())
def test_round_trip_through_json(model: BuildingModel) -> None:
    dto = model_to_dto(model)
    again = model_from_dto(BuildingModelDTO.model_validate_json(dto.model_dump_json()))
    assert again == model


def test_derived_fields_are_output_only() -> None:
    room = Room("r", "sala", (Point2D(0, 0), Point2D(2, 0), Point2D(2, 2), Point2D(0, 2)))
    model = BuildingModel("p", Scale(0.01), (Level("l", "PB", rooms=(room,)),))
    dto = model_to_dto(model)
    assert dto.total_area == 4 and dto.levels[0].rooms[0].area == 4
    # un cliente malicioso no puede imponer el área: el dominio la recalcula
    dto.levels[0].rooms[0].area = 999
    assert model_from_dto(dto).total_area == 4
