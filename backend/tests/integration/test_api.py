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
    assert stages[:4] == ["ingest", "layout", "rectify", "preprocess"]
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


def test_revisions_etag_and_conflict(client: TestClient) -> None:
    pid = _upload(client, encode(render(apartment()).image, ".png"), "image/png")
    _wait_ready(client, pid)
    r = client.get(f"/api/projects/{pid}")
    assert r.headers["etag"] == '"1"' and r.json()["revision"] == 1
    model = r.json()["model"]

    model["levels"][0]["rooms"][0]["label"] = "Cocina"
    ok = client.put(
        f"/api/projects/{pid}/model?summary=Nombres", json=model, headers={"If-Match": '"1"'}
    )
    assert ok.status_code == 200 and ok.headers["etag"] == '"2"'

    # otra pestaña todavía tenía la revisión 1 → 409 y no se pierde nada
    stale = client.put(f"/api/projects/{pid}/model", json=model, headers={"If-Match": '"1"'})
    assert stale.status_code == 409 and "cambió" in stale.json()["detail"]
    assert (
        client.put(
            f"/api/projects/{pid}/model", json=model, headers={"If-Match": "abc"}
        ).status_code
        == 400
    )

    revs = client.get(f"/api/projects/{pid}/revisions").json()
    assert [(r["number"], r["summary"]) for r in revs][:2] == [
        (2, "Nombres"),
        (1, "Detección automática (raster-vector)"),
    ]
    old = client.get(f"/api/projects/{pid}/revisions/1").json()
    assert old["levels"][0]["rooms"][0]["label"] != "Cocina"
    assert client.get(f"/api/projects/{pid}/revisions/42").status_code == 404

    restored = client.post(f"/api/projects/{pid}/revisions/1/restore", headers={"If-Match": '"2"'})
    assert restored.status_code == 200 and restored.json()["revision"] == 3

    quality = client.get(f"/api/projects/{pid}/quality").json()
    assert quality["walls_detected"] == 6 and quality["correction_rate"] == 0


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


def test_dxf_upload_gives_exact_model(client: TestClient) -> None:
    """Un DXF de CAD entra por la ruta vectorial: medidas exactas, sin corrección de esquinas."""
    from tests.synth.complex_plans import casa_compleja
    from tests.synth.to_dxf import plan_to_dxf

    r = client.post(
        "/api/projects",
        # muchos navegadores mandan un .dxf como octet-stream: se reconoce por la extensión
        files={"file": ("casa.dxf", plan_to_dxf(casa_compleja()), "application/octet-stream")},
        data={"name": "Casa CAD"},
    )
    assert r.status_code == 202, r.text
    body = _wait_ready(client, str(r.json()["id"]))
    assert body["status"] == "ready", body.get("error")
    model = body["model"]
    assert model["scale"]["source"] == "vector"
    level = model["levels"][0]
    assert len(level["rooms"]) == 5
    assert len(level["dimensions"]) == 8
    assert all(w["measure"]["status"] == "exact" for w in level["walls"])
    assert any(w["bulge"] for w in level["walls"])
    img = client.get(f"/api/projects/{body['id']}/image?kind=rectified")
    assert img.status_code == 200


def test_rejects_unknown_type(client: TestClient) -> None:
    r = client.post(
        "/api/projects", files={"file": ("x.txt", b"hola", "text/plain")}, data={"name": "x"}
    )
    assert r.status_code == 415


def test_corregir_una_cota_ajusta_los_muros(client: TestClient) -> None:
    """El usuario corrige el valor de una cota → el solver mueve los muros a esa medida."""
    from tests.synth.complex_plans import casa_compleja
    from tests.synth.to_dxf import plan_to_dxf

    r = client.post(
        "/api/projects",
        files={"file": ("casa.dxf", plan_to_dxf(casa_compleja()), "application/dxf")},
        data={"name": "Casa"},
    )
    pid = str(r.json()["id"])
    body = _wait_ready(client, pid)
    model = body["model"]
    level = model["levels"][0]
    # la cota total horizontal (14,00) pasa a 14,50 en el plano corregido
    total = max(
        (d for d in level["dimensions"] if d["axis"] == "horizontal"), key=lambda d: d["value"]
    )
    total["value"] = 14.5
    total["text"] = "14,50"
    put = client.put(
        f"/api/projects/{pid}/model", json=model, headers={"If-Match": f'"{body["revision"]}"'}
    )
    assert put.status_code == 200, put.text
    solved = client.post(f"/api/projects/{pid}/solve")
    assert solved.status_code == 200, solved.text
    report = solved.json()["report"]
    assert report["dims_conflict"] >= 1  # las parciales (5 + 4,5 + 4,5) ya no suman 14,5
    lv = solved.json()["project"]["model"]["levels"][0]
    xs = [p for w in lv["walls"] for p in (w["start"]["x"], w["end"]["x"])]
    # el edificio se estira hacia la nueva cota (entre lo que dicen las parciales y la total)
    assert 14.0 < max(xs) - min(xs) < 14.5 + 0.01
    assert solved.headers["etag"] == f'"{body["revision"] + 2}"'


def test_chequeo_de_captura(client: TestClient) -> None:
    import cv2

    photo = photograph(render(apartment()), seed=1)
    blurry = cv2.GaussianBlur(photo.image, (0, 0), 6)
    r = client.post(
        "/api/capture/check", files={"file": ("x.jpg", encode(blurry, ".jpg"), "image/jpeg")}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and any("movida" in w for w in body["warnings"])


def test_plano_grande_en_varias_fotos(client: TestClient) -> None:
    from tests.synth.complex_plans import STYLES, casa_compleja, render_complex
    from tests.synth.plan_generator import photograph_tiles

    shots = photograph_tiles(
        render_complex(casa_compleja(), STYLES["cad"]), grid=(2, 1), overlap=0.4
    )
    files = [("file", ("a.jpg", encode(shots[0].image, ".jpg"), "image/jpeg"))]
    files += [("extra", ("b.jpg", encode(shots[1].image, ".jpg"), "image/jpeg"))]
    r = client.post("/api/projects", files=files, data={"name": "Casa A1"})
    assert r.status_code == 202, r.text
    body = _wait_ready(client, str(r.json()["id"]), timeout=120)
    assert body["status"] == "ready", body.get("error")
    assert len(body["model"]["levels"][0]["walls"]) >= 5
    orig = client.get(f"/api/projects/{body['id']}/image?kind=original")
    assert orig.headers["content-type"] == "image/png"  # la unión se guarda como PNG
