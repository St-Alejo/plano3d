"""Renders de Blender que sube la app de escritorio: guardar, listar, servir y avisar en vivo."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.application.use_cases import renders as renders_mod
from plano3d.application.use_cases.errors import InvalidRenderError
from plano3d.application.use_cases.renders import sniff
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.demo import DEMO_PROJECT_ID

Json = dict[str, Any]


def _image(ext: str, w: int = 64, h: int = 36) -> bytes:
    img = np.zeros((h, w, 3), np.uint8)
    img[:, : w // 2] = (40, 120, 200)
    ok, buf = cv2.imencode(ext, img)
    assert ok
    return bytes(buf.tobytes())


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(
        mode="memory", auth_required=True, demo_enabled=True, jwt_secret="k" * 40, snapshot="none"
    )
    with TestClient(create_app(settings, container=memory_container())) as c:
        yield c


def _auth(session: Json) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


def _upload(client: TestClient, session: Json, data: bytes, name: str = "r.jpg", **form: str):  # type: ignore[no-untyped-def]
    return client.post(
        f"/api/projects/{DEMO_PROJECT_ID}/renders",
        files={"image": (name, data, "application/octet-stream")},
        data={"label": "Fachada principal", "camera": "Fachada principal", **form},
        headers=_auth(session),
    )


def test_sniff_lee_tipo_y_tamano() -> None:
    assert sniff(_image(".jpg", 320, 180)) == ("image/jpeg", 320, 180)
    assert sniff(_image(".png", 50, 20)) == ("image/png", 50, 20)
    with pytest.raises(InvalidRenderError):
        sniff(b"GIF89a....")


def test_subir_listar_y_servir_el_render_y_la_web_se_entera(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    ticket = client.post("/api/auth/ws-ticket", headers=_auth(demo)).json()["ticket"]
    with client.websocket_connect(f"/api/ws/collab/{DEMO_PROJECT_ID}?ticket={ticket}") as web:
        web.send_json({"type": "hello", "client": "web", "last_seq": None})
        assert web.receive_json()["type"] == "welcome"

        jpg = _image(".jpg", 640, 360)
        r = _upload(client, demo, jpg, quality="final", hour="atardecer")
        assert r.status_code == 201, r.text
        render = r.json()
        assert render["width"] == 640 and render["height"] == 360
        assert render["media_type"] == "image/jpeg" and render["quality"] == "final"

        msg = web.receive_json()
        assert msg["type"] == "render_added" and msg["render"]["id"] == render["id"]

    listed = client.get(f"/api/projects/{DEMO_PROJECT_ID}/renders", headers=_auth(demo)).json()
    assert [x["id"] for x in listed] == [render["id"]]
    img = client.get(f"/api/projects/{DEMO_PROJECT_ID}/renders/{render['id']}", headers=_auth(demo))
    assert img.status_code == 200 and img.content == jpg
    assert img.headers["content-type"] == "image/jpeg"
    missing = client.get(f"/api/projects/{DEMO_PROJECT_ID}/renders/otro", headers=_auth(demo))
    assert missing.status_code == 404


def test_rechaza_lo_que_no_es_imagen_y_lo_ajeno(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    bad = _upload(client, demo, b"esto no es una imagen", name="x.txt")
    assert bad.status_code == 422
    assert _upload(client, demo, b"").status_code == 422

    other = client.post(
        "/api/auth/register",
        json={"email": "otra@ejemplo.com", "name": "Otra", "password": "clave-larga-123"},
    ).json()
    assert _upload(client, other, _image(".png")).status_code == 404
    listing = client.get(f"/api/projects/{DEMO_PROJECT_ID}/renders", headers=_auth(other))
    assert listing.status_code == 404


def test_tope_de_renders_borra_el_mas_viejo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(renders_mod, "MAX_RENDERS", 2)
    demo = client.post("/api/auth/demo").json()
    ids = [_upload(client, demo, _image(".png")).json()["id"] for _ in range(3)]
    listed = client.get(f"/api/projects/{DEMO_PROJECT_ID}/renders", headers=_auth(demo)).json()
    assert [x["id"] for x in listed] == ids[1:]
    gone = client.get(f"/api/projects/{DEMO_PROJECT_ID}/renders/{ids[0]}", headers=_auth(demo))
    assert gone.status_code == 404
