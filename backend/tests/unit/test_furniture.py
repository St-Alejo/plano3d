"""Mobiliario y acabados (ADR-016): invariantes del dominio e ida y vuelta por el contrato."""

import math

import pytest

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.domain import BuildingModel, Furniture, Level, Point2D, Room, Scale
from plano3d.domain.errors import InvalidGeometryError

SQUARE = (Point2D(0, 0), Point2D(4, 0), Point2D(4, 4), Point2D(0, 4))


def bed(fid: str = "f1", **kw: object) -> Furniture:
    args: dict[str, object] = {
        "id": fid,
        "catalog_id": "cama_doble",
        "position": Point2D(2, 2),
        "width": 1.4,
        "depth": 1.9,
        "height": 0.5,
        "rotation": math.pi / 2,
    }
    args.update(kw)
    return Furniture(**args)  # type: ignore[arg-type]


def test_mueble_valido_y_sus_invariantes() -> None:
    assert bed().catalog_id == "cama_doble"
    with pytest.raises(InvalidGeometryError):
        bed(catalog_id="Cama Doble")
    with pytest.raises(InvalidGeometryError):
        bed(width=0)
    with pytest.raises(InvalidGeometryError):
        bed(rotation=math.inf)


def test_al_reescalar_se_mueve_pero_conserva_su_tamano_real() -> None:
    f = bed().scaled(2.0)
    assert f.position == Point2D(4, 4)
    assert (f.width, f.depth, f.height) == (1.4, 1.9, 0.5)


def test_nivel_rechaza_ids_de_muebles_repetidos() -> None:
    with pytest.raises(InvalidGeometryError):
        Level("l0", "PB", furniture=(bed("f1"), bed("f1")))


def test_material_de_piso_valido() -> None:
    assert Room("r", "sala", SQUARE, floor_material="madera_roble").floor_material == "madera_roble"
    with pytest.raises(InvalidGeometryError):
        Room("r", "sala", SQUARE, floor_material="Madera roble!")


def test_ida_y_vuelta_por_el_contrato() -> None:
    model = BuildingModel(
        "p",
        Scale(0.01, "calibrated", 1.0),
        (
            Level(
                "l0",
                "PB",
                rooms=(Room("r", "sala", SQUARE, floor_material="porcelanato"),),
                furniture=(bed(),),
            ),
        ),
    )
    dto = model_to_dto(model)
    again = model_from_dto(BuildingModelDTO.model_validate(dto.model_dump(mode="json")))
    assert again.levels[0].furniture == (bed(),)
    assert again.levels[0].rooms[0].floor_material == "porcelanato"


def test_modelo_v2_sin_muebles_sigue_siendo_valido() -> None:
    raw = {
        "project_id": "p",
        "scale": {"meters_per_pixel": 0.01},
        "levels": [
            {
                "id": "l0",
                "name": "PB",
                "rooms": [
                    {
                        "id": "r",
                        "label": "sala",
                        "polygon": [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 4}],
                    }
                ],
            }
        ],
    }
    model = model_from_dto(BuildingModelDTO.model_validate(raw))
    assert model.levels[0].furniture == ()
    assert model.levels[0].rooms[0].floor_material is None
