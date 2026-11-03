"""Pisos por la API: sumar un PDF como piso nuevo y duplicarlo (el piso 3 igual al 2)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container

PISO2 = Path(__file__).parent.parent / "real" / "opc3p2" / "plano.pdf"


@pytest.fixture
def client() -> TestClient:
    app = create_app(Settings(mode="memory"), container=memory_container())
    with TestClient(app) as c:
        yield c  # type: ignore[misc]


def test_agregar_piso_desde_pdf_y_duplicarlo(client: TestClient) -> None:
    body = client.post("/api/projects/blank", json={"name": "Casa"}).json()
    pid = body["id"]

    r = client.post(
        f"/api/projects/{pid}/levels",
        files={"file": ("piso2.pdf", PISO2.read_bytes(), "application/pdf")},
        data={"name": "Piso 2"},
        headers={"If-Match": f'"{body["revision"]}"'},
    )
    assert r.status_code == 201, r.text
    levels = r.json()["model"]["levels"]
    assert [lv["name"] for lv in levels][1:] == ["Piso 2"]
    assert levels[1]["elevation"] == pytest.approx(2.6)
    assert len(levels[1]["rooms"]) == 8 and len(levels[1]["stairs"]) == 3

    dup = client.post(f"/api/projects/{pid}/levels/{levels[1]['id']}/duplicate", json={})
    assert dup.status_code == 201, dup.text
    levels = dup.json()["model"]["levels"]
    assert [lv["name"] for lv in levels][1:] == ["Piso 2", "Piso 3"]
    assert levels[2]["elevation"] == pytest.approx(5.2)
    # la escalera del 2 lleva al 3; la del 3, a la cubierta
    assert {s["to_level_id"] for s in levels[1]["stairs"]} == {levels[2]["id"]}
    assert {s["to_level_id"] for s in levels[2]["stairs"]} == {None}
    # la copia tiene la misma planta con ids propios
    assert len(levels[2]["walls"]) == len(levels[1]["walls"])
    assert not {w["id"] for w in levels[1]["walls"]} & {w["id"] for w in levels[2]["walls"]}


def test_errores(client: TestClient) -> None:
    pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
    assert client.post(f"/api/projects/{pid}/levels/nope/duplicate").status_code == 404
    bad = client.post(
        f"/api/projects/{pid}/levels", files={"file": ("x.txt", b"hola", "text/plain")}
    )
    assert bad.status_code in (415, 422)
    stale = client.post(f"/api/projects/{pid}/levels/lvl_0/duplicate", headers={"If-Match": '"99"'})
    assert stale.status_code == 409


def test_la_fachada_cambia_solo_la_fachada(client: TestClient) -> None:
    body = client.post("/api/projects/blank", json={"name": "Casa"}).json()
    pid = body["id"]
    r = client.post(
        f"/api/projects/{pid}/levels",
        files={"file": ("piso2.pdf", PISO2.read_bytes(), "application/pdf")},
    )
    before = r.json()
    assert before["model"]["facade"] == "moderna_blanca"
    r = client.put(
        f"/api/projects/{pid}/facade",
        json={"style": "moderna_ladrillo"},
        headers={"If-Match": f'"{before["revision"]}"'},
    )
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["model"]["facade"] == "moderna_ladrillo"
    assert after["revision"] == before["revision"] + 1
    # niveles, muros, vanos y ambientes idénticos
    assert after["model"]["levels"] == before["model"]["levels"]
    revisions = client.get(f"/api/projects/{pid}/revisions").json()
    assert revisions[0]["summary"] == "Fachada: moderna ladrillo"
    assert client.get(f"/api/projects/{pid}").json()["model"]["facade"] == "moderna_ladrillo"
    bad = client.put(f"/api/projects/{pid}/facade", json={"style": "colonial"})
    assert bad.status_code == 422


def test_amoblar_completa_lo_que_falta_sin_mover_lo_dibujado(client: TestClient) -> None:
    pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
    before = client.post(
        f"/api/projects/{pid}/levels",
        files={"file": ("piso2.pdf", PISO2.read_bytes(), "application/pdf")},
    ).json()
    lv = before["model"]["levels"][-1]
    drawn = lv["furniture"]
    # el plano ya trae las camas, la cocina, el comedor, el sofá y los baños
    assert sum(f["catalog_id"] == "cama_doble" for f in drawn) == 3
    r = client.post(
        f"/api/projects/{pid}/furnish",
        json={"level_id": lv["id"]},
        headers={"If-Match": f'"{before["revision"]}"'},
    )
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["revision"] == before["revision"] + 1
    furniture = after["model"]["levels"][-1]["furniture"]
    assert furniture[: len(drawn)] == drawn
    added = [f["catalog_id"] for f in furniture[len(drawn) :]]
    assert added.count("closet") == 3 and "nevera" in added
    revisions = client.get(f"/api/projects/{pid}/revisions").json()
    assert revisions[0]["summary"].startswith("Amoblado: ")
    # otra vez: ya no falta nada y no se crea revisión
    again = client.post(f"/api/projects/{pid}/furnish").json()
    assert again["revision"] == after["revision"]
    assert client.post(f"/api/projects/{pid}/furnish", json={"level_id": "nope"}).status_code == 404


def test_la_fachada_se_personaliza_sobre_el_estilo(client: TestClient) -> None:
    pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
    before = client.post(
        f"/api/projects/{pid}/levels",
        files={"file": ("piso2.pdf", PISO2.read_bytes(), "application/pdf")},
    ).json()
    custom = {"upper": {"material": "madera"}, "frame": "#111111", "features": ["jardinera"]}
    r = client.put(
        f"/api/projects/{pid}/facade",
        json={"style": "moderna_contemporanea", "custom": custom},
        headers={"If-Match": f'"{before["revision"]}"'},
    )
    assert r.status_code == 200, r.text
    after = r.json()["model"]
    assert after["facade"] == "moderna_contemporanea"
    assert after["facade_custom"]["upper"] == {"material": "madera", "color": None}
    assert after["facade_custom"]["features"] == ["jardinera"]
    assert after["levels"] == before["model"]["levels"]
    summary = client.get(f"/api/projects/{pid}/revisions").json()[0]["summary"]
    assert summary == "Fachada: moderna contemporanea (personalizada)"
    # elegir el estilo sin cambios lo deja limpio
    clean = client.put(f"/api/projects/{pid}/facade", json={"style": "moderna_contemporanea"})
    assert clean.json()["model"]["facade_custom"] is None
    bad = {"style": "moderna_blanca", "custom": {"features": ["piscina"]}}
    assert client.put(f"/api/projects/{pid}/facade", json=bad).status_code == 422
