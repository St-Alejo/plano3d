"""Fachada paramétrica: estilo base + cambios (domain/facade.py) e ida y vuelta por el DTO."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from plano3d.application.dto import (
    BuildingModelDTO,
    FacadeDTO,
    custom_from_dto,
    model_from_dto,
    model_to_dto,
)
from plano3d.domain import BuildingModel, Scale
from plano3d.domain.errors import InvalidGeometryError
from plano3d.domain.facade import FacadeCustom, FacadeSurface


def model(**kw: object) -> BuildingModel:
    return BuildingModel(project_id="p", scale=Scale(0.01, "vector", 1.0), **kw)  # type: ignore[arg-type]


def test_lo_cambiado_se_valida() -> None:
    FacadeCustom(upper=FacadeSurface("madera"), frame="#101010", features=("jardinera",))
    with pytest.raises(InvalidGeometryError):
        FacadeSurface("marmol")
    with pytest.raises(InvalidGeometryError):
        FacadeCustom(frame="negro")
    with pytest.raises(InvalidGeometryError):
        FacadeCustom(features=("piscina",))
    with pytest.raises(InvalidGeometryError):
        FacadeCustom(features=("luces", "luces"))


def test_una_personalizacion_vacia_es_el_estilo_tal_cual() -> None:
    m = model().with_facade("moderna_contemporanea", FacadeCustom())
    assert m.facade == "moderna_contemporanea"
    assert m.facade_custom is None
    custom = FacadeCustom(ground=FacadeSurface("ladrillo"), features=())
    assert model().with_facade("moderna_blanca", custom).facade_custom == custom


def test_ida_y_vuelta_por_el_contrato() -> None:
    custom = FacadeCustom(
        ground=FacadeSurface("concreto", "#b8b6b0"),
        front=FacadeSurface(color="#ffffff"),
        accent="#3b3e42",
        features=("listones", "alero"),
    )
    m = model(facade="moderna_contemporanea", facade_custom=custom)
    back = model_from_dto(BuildingModelDTO.model_validate(model_to_dto(m).model_dump()))
    assert back == m
    # un modelo guardado antes de la fachada paramétrica no trae facade_custom
    old = model_to_dto(model()).model_dump()
    old.pop("facade_custom")
    assert model_from_dto(BuildingModelDTO.model_validate(old)).facade_custom is None


def test_el_contrato_rechaza_lo_que_el_visor_no_sabe_pintar() -> None:
    with pytest.raises(ValidationError):
        FacadeDTO.model_validate({"style": "moderna_blanca", "custom": {"frame": "rojo"}})
    with pytest.raises(ValidationError):
        FacadeDTO.model_validate(
            {"style": "moderna_blanca", "custom": {"upper": {"material": "vidrio"}}}
        )
    dto = FacadeDTO.model_validate({"style": "moderna_blanca", "custom": {"features": []}})
    assert custom_from_dto(dto.custom) == FacadeCustom(features=())
