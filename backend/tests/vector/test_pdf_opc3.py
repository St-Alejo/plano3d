"""Casa "opción 3" en PDF vectorial (CAD 1:50): piso 1 con parqueaderos y piso 2.

El piso 1 no rotula ningún ambiente: los nombres salen de lo dibujado (portones, huellas,
sanitarios). La escalera en U viene en pluma fina, en tres tramos cortos."""

from __future__ import annotations

from pathlib import Path

import pytest

from plano3d.domain import BuildingModel, OpeningKind, OpeningOperation
from plano3d.infrastructure.vector.builder import VectorContext, vector_stages
from plano3d.infrastructure.vector.pdf import read_pdf

REAL = Path(__file__).parent.parent / "real"


def detect(case: str) -> BuildingModel:
    ctx = VectorContext("prj", (REAL / case / "plano.pdf").read_bytes(), read_pdf)
    for stage in vector_stages():
        ctx = stage.run(ctx)
    assert ctx.model is not None
    return ctx.model


@pytest.fixture(scope="module")
def piso1() -> BuildingModel:
    return detect("opc3p1")


@pytest.fixture(scope="module")
def piso2() -> BuildingModel:
    return detect("opc3p2")


def test_piso1_ambientes_sin_rotulo(piso1: BuildingModel) -> None:
    labels = sorted(r.label for r in piso1.levels[0].rooms)
    assert labels == ["Baño 1", "Baño 2", "Hall", "Parqueadero 1", "Parqueadero 2"]


def test_piso1_portones_plegables_y_reticula(piso1: BuildingModel) -> None:
    lv = piso1.levels[0]
    gates = [o for w in lv.walls for o in w.openings if o.operation is OpeningOperation.FOLDING]
    assert len(gates) == 2
    assert all(o.width == pytest.approx(2.0, abs=0.1) for o in gates)
    # 3 x 4 columnas en los cruces de ejes; el lavamanos relleno no es una de ellas
    assert len(lv.columns) == 12


@pytest.mark.parametrize("case", ["piso1", "piso2"])
def test_escalera_en_u_sube_el_piso(case: str, request: pytest.FixtureRequest) -> None:
    stairs = request.getfixturevalue(case).levels[0].stairs
    assert len(stairs) == 3
    last = max(stairs, key=lambda s: s.base)
    assert last.base + last.riser * last.steps == pytest.approx(2.6)
    assert all(s.riser <= 0.185 for s in stairs)


def test_piso2_nombres_del_cad_y_paso_al_pasillo(piso2: BuildingModel) -> None:
    lv = piso2.levels[0]
    labels = {r.label for r in lv.rooms}
    assert {"ALCOBA 1", "ALCOBA 2", "ALCOBA 3", "Escalera", "Pasillo"} <= labels
    assert "SALA-COMEDOR / COCINA" in labels
    # ninguna puerta atraviesa un muro: la más ancha es la de un baño o un paso
    doors = [o for w in lv.walls for o in w.openings if o.kind is OpeningKind.DOOR]
    assert max(o.width for o in doors) < 1.2


def _furniture_by_room(model: BuildingModel) -> dict[str, list[str]]:
    lv = model.levels[0]
    out: dict[str, list[str]] = {r.label: [] for r in lv.rooms}
    for f in lv.furniture:
        room = next(r for r in lv.rooms if f.id.startswith(f"f_{r.id}_"))
        out[room.label].append(f.catalog_id)
    return out


def test_piso2_muebles_dibujados_en_el_cad(piso2: BuildingModel) -> None:
    by_room = _furniture_by_room(piso2)
    for alcoba in ("ALCOBA 1", "ALCOBA 2", "ALCOBA 3"):
        assert by_room[alcoba] == ["cama_doble"]
    assert sorted(by_room["SALA-COMEDOR / COCINA"]) == [
        "cocina_lineal",
        "cocina_lineal",
        "comedor_4",
        "sofa_3",
    ]
    for bano in ("Baño 1", "Baño 2"):
        assert sorted(by_room[bano]) == ["lavamanos", "sanitario"]
    # cada mueble queda dentro de su ambiente
    lv = piso2.levels[0]
    for f in lv.furniture:
        room = next(r for r in lv.rooms if f.id.startswith(f"f_{r.id}_"))
        xs, ys = [p.x for p in room.polygon], [p.y for p in room.polygon]
        assert min(xs) < f.position.x < max(xs) and min(ys) < f.position.y < max(ys)


def test_piso1_solo_los_aparatos_de_los_banos(piso1: BuildingModel) -> None:
    by_room = _furniture_by_room(piso1)
    assert sorted(by_room["Baño 1"]) == sorted(by_room["Baño 2"]) == ["lavamanos", "sanitario"]
    assert by_room["Parqueadero 1"] == by_room["Parqueadero 2"] == []
