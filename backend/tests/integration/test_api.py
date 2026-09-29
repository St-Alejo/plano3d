"""API de punta a punta en modo memoria: subir foto → pipeline real → modelo → edición."""

from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container
from tests.synth.plan_generator import apartment, encode, photograph, render


@pytest.fixture
def client() -> TestClient:
    app = create_app(Settings(mode="memory"), container=memory_container())
    with TestClient(app) as c:
        yield c  # type: ignore[misc]


def _upload(client: TestClient, data: bytes, ctype: str = "image/jpeg", **form: str) -> str:
    r = client.post(
        "/api/projects",
        files={"file": ("plano.jpg", data, ctype)},
        data={"name": "Depto", **form},
    )
    assert r.status_code == 202, r.text
    return str(r.json()["id"])


def _wait_ready(client: TestClient, pid: str, timeout: float = 30) -> dict:  # type: ignore[type-arg]
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/projects/{pid}").json()
        if body["status"] in ("ready", "failed"):
            return body  # type: ignore[no-any-return]
        time.sleep(0.1)
    raise AssertionError("el análisis no terminó a tiempo")


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_openapi_exposes_building_model_schema(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert {"BuildingModelDTO", "WallDTO", "RoomDTO", "ProgressEventDTO"} <= set(schemas)


def test_full_flow_photo_to_model(client: TestClient) -> None:
    photo = photograph(render(apartment()), seed=2)
    pid = _upload(client, encode(photo.image, ".jpg"))

    # el WebSocket entrega el historial y termina con "done"
    with client.websocket_connect(f"/api/ws/projects/{pid}") as ws:
        events = []
        while True:
            ev = json.loads(ws.receive_text())
            events.append(ev)
            if ev["stage"] == "done":
                break
    stages = [e["stage"] for e in events if e["status"] == "completed"]
    assert stages[:3] == ["ingest", "rectify", "preprocess"]
    assert events[-1]["status"] == "completed"
    assert any(e.get("preview") for e in events), "falta el modelo parcial (revelado progresivo)"

    body = _wait_ready(client, pid)
    assert body["status"] == "ready", body.get("error")
    level = body["model"]["levels"][0]
    assert len(level["rooms"]) == 3 and len(level["walls"]) == 6

    img = client.get(f"/api/projects/{pid}/image?kind=rectified")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert (
        client.get(f"/api/projects/{pid}/image?kind=original").headers["content-type"]
        == "image/jpeg"
    )

    summaries = client.get("/api/projects").json()
    assert summaries[0]["id"] == pid and summaries[0]["room_count"] == 3


def test_edit_calibrate_and_validation(client: TestClient) -> None:
    pid = _upload(client, encode(render(apartment()).image, ".png"), "image/png")
    body = _wait_ready(client, pid)
    model = body["model"]

    model["levels"][0]["rooms"][0]["label"] = "Cocina"
    r = client.put(f"/api/projects/{pid}/model", json=model)
    assert r.status_code == 200
    assert r.json()["model"]["levels"][0]["rooms"][0]["label"] == "Cocina"

    # abertura imposible → 422 con mensaje del dominio
    bad = json.loads(json.dumps(model))
    wall = bad["levels"][0]["walls"][0]
    wall["openings"] = [{"id": "x", "kind": "door", "offset": 0, "width": 999, "height": 2}]
    r = client.put(f"/api/projects/{pid}/model", json=bad)
    assert r.status_code == 422 and "abertura" in r.json()["detail"]

    # la cota superior del plano mide 10 m entre ejes del muro exterior
    walls = model["levels"][0]["walls"]
    mpp = model["scale"]["meters_per_pixel"]
    top = min(walls, key=lambda w: w["start"]["y"] + w["end"]["y"])
    a = {"x": top["start"]["x"] / mpp, "y": top["start"]["y"] / mpp}
    b = {"x": top["end"]["x"] / mpp, "y": top["end"]["y"] / mpp}
    r = client.post(f"/api/projects/{pid}/scale", json={"a": a, "b": b, "meters": 10.0})
    assert r.status_code == 200
    calibrated = r.json()["model"]
    assert calibrated["scale"]["source"] == "calibrated"
    # con la escala real, el área total se acerca a la verdad (21.9 + 15.9 + 25.3 m²)
    assert calibrated["total_area"] == pytest.approx(63.2, rel=0.08)


def test_suggest_corners(client: TestClient) -> None:
    photo = photograph(render(apartment()), seed=1)
    h, w = photo.image.shape[:2]
    r = client.post(
        "/api/corners", files={"file": ("f.jpg", encode(photo.image, ".jpg"), "image/jpeg")}
    )
    assert r.status_code == 200
    got = r.json()["corners"]
    assert len(got) == 4
    for (gx, gy), (tx, ty) in zip(got, photo.corners, strict=True):
        assert abs(gx - tx / w) < 0.01 and abs(gy - ty / h) < 0.01
    # un escaneo sin fondo no tiene hoja que recortar
    clean = client.post(
        "/api/corners",
        files={"file": ("p.png", encode(render(apartment()).image), "image/png")},
    )
    assert clean.json() == {"corners": None}
    bad = client.post("/api/corners", files={"file": ("x.png", b"basura", "image/png")})
    assert bad.status_code == 415


def test_errors(client: TestClient) -> None:
    assert client.get("/api/projects/nope").status_code == 404
    r = client.post("/api/projects", files={"file": ("a.gif", b"GIF89a", "image/gif")})
    assert r.status_code == 415
    r = client.post(
        "/api/projects",
        files={"file": ("a.png", b"x", "image/png")},
        data={"corners": "[[0,0],[1,0]]"},
    )
    assert r.status_code == 422
    r = client.post(
        "/api/projects",
        files={"file": ("a.png", b"x", "image/png")},
        data={"corners": "no-json"},
    )
    assert r.status_code == 422


def test_garbage_image_ends_failed_and_can_be_reanalyzed(client: TestClient) -> None:
    pid = _upload(client, b"esto no es una imagen", "image/png")
    body = _wait_ready(client, pid)
    assert body["status"] == "failed" and body["error"]
    r = client.post(
        f"/api/projects/{pid}/reanalyze", json={"corners": [[0, 0], [1, 0], [1, 1], [0, 1]]}
    )
    assert r.status_code == 202
    r = client.post(
        f"/api/projects/{pid}/reanalyze", json={"corners": [[0, 0], [2, 0], [1, 1], [0, 1]]}
    )
    assert r.status_code in (409, 422)


def test_delete(client: TestClient) -> None:
    pid = _upload(client, encode(render(apartment()).image, ".png"), "image/png")
    _wait_ready(client, pid)
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
