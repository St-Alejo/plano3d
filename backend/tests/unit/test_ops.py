"""Contrato de ops (ADR-019): los casos de tests/fixtures/ops son los mismos que usan la web
(vitest) y el escritorio (xunit), así las tres implementaciones significan lo mismo."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from plano3d.application.ops import (
    InvalidOpError,
    apply_ops,
    apply_ops_to_model,
    canonical,
    diff_models,
    model_json,
)
from plano3d.domain import BuildingModel, Level, Point2D, Scale, Wall
from plano3d.domain.errors import DomainError

CASES = json.loads(
    (Path(__file__).parents[1] / "fixtures" / "ops" / "cases.json").read_text(encoding="utf-8")
)


def _ids(case: dict[str, Any]) -> str:
    return str(case["name"])


@pytest.mark.parametrize("case", [c for c in CASES["cases"] if "apply" in c["check"]], ids=_ids)
def test_apply_segun_los_casos_compartidos(case: dict[str, Any]) -> None:
    assert canonical(apply_ops(case["before"], case["ops"])) == canonical(case["after"])


@pytest.mark.parametrize("case", [c for c in CASES["cases"] if "diff" in c["check"]], ids=_ids)
def test_diff_segun_los_casos_compartidos(case: dict[str, Any]) -> None:
    assert diff_models(case["before"], case["after"]) == case["ops"]


@pytest.mark.parametrize("case", CASES["errors"], ids=_ids)
def test_cambios_mal_formados_se_rechazan(case: dict[str, Any]) -> None:
    with pytest.raises(InvalidOpError):
        apply_ops(case["before"], case["ops"])


def test_apply_no_modifica_el_original() -> None:
    case = CASES["cases"][0]
    before = json.dumps(case["before"], sort_keys=True)
    apply_ops(case["before"], case["ops"])
    assert json.dumps(case["before"], sort_keys=True) == before


def _model() -> BuildingModel:
    wall = Wall("w1", Point2D(0, 0), Point2D(4, 0))
    return BuildingModel("p1", Scale(0.01, "vector", 1.0), (Level("L1", "Piso 1", walls=(wall,)),))


def test_diff_y_apply_hacen_ida_y_vuelta_con_el_dominio() -> None:
    before = _model()
    data = model_json(before)
    data["levels"][0]["walls"][0]["end"] = {"x": 5.0, "y": 0.0}
    ops = diff_models(model_json(before), data)
    after = apply_ops_to_model(before, ops)
    assert after.level("L1").wall("w1").length == pytest.approx(5.0)
    assert diff_models(model_json(after), data) == []


def test_un_cambio_que_rompe_el_edificio_lanza_error_de_dominio() -> None:
    before = _model()
    tiny = {
        "id": "w1",
        "start": {"x": 0, "y": 0},
        "end": {"x": 0.01, "y": 0},
    }
    with pytest.raises(DomainError):
        apply_ops_to_model(
            before, [{"t": "put", "k": "wall", "level": "L1", "id": "w1", "v": tiny}]
        )
    assert before.level("L1").wall("w1").length == pytest.approx(4.0)


def test_el_project_id_no_se_puede_cambiar_con_ops() -> None:
    after = apply_ops_to_model(
        _model(), [{"t": "set", "k": "model", "f": "facade", "v": "moderna_madera"}]
    )
    assert after.project_id == "p1"
    assert after.facade == "moderna_madera"
