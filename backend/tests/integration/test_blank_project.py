"""Plano desde cero: se crea sin foto, listo para editar, y se guarda como cualquier otro."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.domain import Project, ProjectStatus


@pytest.fixture
def client() -> TestClient:
    app = create_app(Settings(mode="memory"), container=memory_container())
    with TestClient(app) as c:
        yield c  # type: ignore[misc]


def test_domain_blank_project_is_ready_with_an_empty_level() -> None:
    p = Project.create_blank("  Casa nueva  ")
    assert p.status is ProjectStatus.READY
    assert not p.has_source
    assert p.model is not None
    assert p.model.scale.source == "vector"
    assert [(lv.id, len(lv.walls)) for lv in p.model.levels] == [("lvl_0", 0)]


def test_create_blank_and_save_a_drawn_wall(client: TestClient) -> None:
    r = client.post("/api/projects/blank", json={"name": "Desde cero"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "ready"
    assert body["has_source"] is False
    assert body["model"]["levels"][0]["walls"] == []
    pid = body["id"]

    model = body["model"]
    model["levels"][0]["walls"] = [
        {
            "id": "w1",
            "start": {"x": 0, "y": 0},
            "end": {"x": 4, "y": 0},
            "thickness": 0.15,
            "height": 2.6,
            "openings": [],
            "confidence": 1,
        }
    ]
    saved = client.put(
        f"/api/projects/{pid}/model", json=model, headers={"If-Match": f'"{body["revision"]}"'}
    )
    assert saved.status_code == 200, saved.text
    assert len(saved.json()["model"]["levels"][0]["walls"]) == 1

    # aparece en la lista y se puede borrar aunque no tenga archivo
    assert any(
        p["id"] == pid and p["has_source"] is False for p in client.get("/api/projects").json()
    )
    assert client.get(f"/api/projects/{pid}/revisions").status_code == 200
    assert client.delete(f"/api/projects/{pid}").status_code == 204


def test_blank_project_has_no_image_and_cannot_be_reanalyzed(client: TestClient) -> None:
    pid = client.post("/api/projects/blank", json={}).json()["id"]
    assert client.get(f"/api/projects/{pid}/image?kind=original").status_code == 404
    assert client.get(f"/api/projects/{pid}/image").status_code == 404
    r = client.post(f"/api/projects/{pid}/reanalyze", json={})
    assert r.status_code == 422
    assert "desde cero" in r.json()["detail"]


def test_blank_name_is_validated(client: TestClient) -> None:
    assert client.post("/api/projects/blank", json={"name": ""}).status_code == 422
