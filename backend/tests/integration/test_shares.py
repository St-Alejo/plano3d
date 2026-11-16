"""Compartir un proyecto con Interiores 3D por un código (ADR-024), de punta a punta."""

from __future__ import annotations

import copy
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.demo import DEMO_PROJECT_ID

Json = dict[str, Any]
SHARES = f"/api/projects/{DEMO_PROJECT_ID}/shares"
WS = f"/api/ws/collab/{DEMO_PROJECT_ID}"


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(
        mode="memory", auth_required=True, demo_enabled=True, jwt_secret="k" * 40, snapshot="none"
    )
    with TestClient(create_app(settings, container=memory_container())) as c:
        yield c


@pytest.fixture
def demo(client: TestClient) -> dict[str, str]:
    session = client.post("/api/auth/demo").json()
    return {"Authorization": f"Bearer {session['access_token']}"}


def _until(ws: Any, kind: str) -> Json:
    for _ in range(20):
        msg: Json = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"no llegó {kind}")


def _claim(client: TestClient, code: str) -> Json:
    res = client.post("/api/shares/claim", json={"code": code})
    assert res.status_code == 200, res.text
    grant: Json = res.json()
    return grant


def test_el_dueño_crea_lista_y_la_otra_app_canjea(client: TestClient, demo: dict[str, str]) -> None:
    created = client.post(SHARES, headers=demo)
    assert created.status_code == 201, created.text
    code = created.json()["code"]
    assert len(code) == 9 and code[4] == "-"  # K7QM-3XTP

    # se canjea como se pega: minúsculas, sin guion y con espacios
    grant = _claim(client, f"  {code.replace('-', '').lower()} ")
    assert grant["project_id"] == DEMO_PROJECT_ID and grant["role"] == "interiores"

    project = client.get(
        "/api/shares/project", headers={"Authorization": f"Bearer {grant['token']}"}
    )
    assert project.status_code == 200
    assert project.json()["model"]["levels"]

    listed = client.get(SHARES, headers=demo).json()
    assert [s["code"] for s in listed] == [code]
    assert listed[0]["claimed_at"] is not None


def test_el_token_de_enlace_no_abre_otras_rutas_ni_sirve_como_sesion(
    client: TestClient, demo: dict[str, str]
) -> None:
    code = client.post(SHARES, headers=demo).json()["code"]
    link = {"Authorization": f"Bearer {_claim(client, code)['token']}"}
    assert client.get("/api/projects", headers=link).status_code == 401
    assert client.get(f"/api/projects/{DEMO_PROJECT_ID}", headers=link).status_code == 401
    # y una sesión normal no sirve como token de enlace
    assert client.get("/api/shares/project", headers=demo).status_code == 401


def test_revocar_corta_el_acceso_al_instante(client: TestClient, demo: dict[str, str]) -> None:
    code = client.post(SHARES, headers=demo).json()["code"]
    link = {"Authorization": f"Bearer {_claim(client, code)['token']}"}
    assert client.delete(f"{SHARES}/{code}", headers=demo).status_code == 204
    assert client.get("/api/shares/project", headers=link).status_code == 401
    assert client.post("/api/shares/claim", json={"code": code}).status_code == 404
    assert client.get(SHARES, headers=demo).json() == []


def test_codigos_invalidos_y_proyectos_ajenos(client: TestClient, demo: dict[str, str]) -> None:
    assert client.post("/api/shares/claim", json={"code": "AAAA-BBBB"}).status_code == 404
    assert client.post("/api/shares/claim", json={"code": "0000-1111"}).status_code == 422
    # sin sesión no se crean códigos; y otra cuenta no ve los del proyecto demo
    assert client.post(SHARES).status_code == 401
    other = client.post(
        "/api/auth/register",
        json={"email": "ana@example.com", "name": "Ana", "password": "una-clave-larga"},
    ).json()
    headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.post(SHARES, headers=headers).status_code == 404


def test_maximo_de_codigos_activos(client: TestClient, demo: dict[str, str]) -> None:
    for _ in range(5):
        assert client.post(SHARES, headers=demo).status_code == 201
    assert client.post(SHARES, headers=demo).status_code == 409


def test_interiores_en_vivo_mueve_muebles_pero_no_muros(
    client: TestClient, demo: dict[str, str]
) -> None:
    code = client.post(SHARES, headers=demo).json()["code"]
    token = _claim(client, code)["token"]
    session = client.post("/api/auth/demo").json()
    ticket = client.post(
        "/api/auth/ws-ticket", headers={"Authorization": f"Bearer {session['access_token']}"}
    ).json()["ticket"]

    with (
        client.websocket_connect(f"{WS}?ticket={ticket}") as web,
        client.websocket_connect(f"{WS}?link={token}") as interiores,
    ):
        web.send_json({"type": "hello", "client": "web", "last_seq": None})
        _until(web, "welcome")
        interiores.send_json({"type": "hello", "client": "web", "name": "Ana · Interiores"})
        welcome = _until(interiores, "welcome")
        assert welcome["you"]["client"] == "interiores"
        assert welcome["you"]["name"] == "Ana · Interiores"
        assert _until(web, "peer_joined")["peer"]["client"] == "interiores"

        level = welcome["model"]["levels"][0]
        sofa = copy.deepcopy(level["furniture"][0])
        sofa["position"]["x"] += 0.4
        put = {"t": "put", "k": "furniture", "level": level["id"], "id": sofa["id"], "v": sofa}
        interiores.send_json({"type": "ops", "op_id": "i-1", "ops": [put]})
        assert _until(web, "applied")["op_id"] == "i-1"

        room = copy.deepcopy(level["rooms"][0])
        room["floor_material"] = "madera_roble"
        finish = {"t": "put", "k": "room", "level": level["id"], "id": room["id"], "v": room}
        interiores.send_json({"type": "ops", "op_id": "i-2", "ops": [finish]})
        assert _until(web, "applied")["op_id"] == "i-2"

        wall = copy.deepcopy(level["walls"][0])
        wall["thickness"] = 0.5
        bad = {"t": "put", "k": "wall", "level": level["id"], "id": wall["id"], "v": wall}
        interiores.send_json({"type": "ops", "op_id": "i-3", "ops": [bad]})
        reject = _until(interiores, "reject")
        assert reject["op_id"] == "i-3" and "Plano 3D" in reject["reason"]

        moved = copy.deepcopy(room)
        moved["polygon"][0]["x"] += 1.0
        grow = {"t": "put", "k": "room", "level": level["id"], "id": room["id"], "v": moved}
        interiores.send_json({"type": "ops", "op_id": "i-4", "ops": [grow]})
        assert _until(interiores, "reject")["op_id"] == "i-4"

        # la web, dueña de la arquitectura, sí puede cambiar el muro
        web.send_json({"type": "ops", "op_id": "w-1", "ops": [bad]})
        assert _until(interiores, "applied")["op_id"] == "w-1"


def test_la_sala_rechaza_enlaces_revocados_o_de_otro_proyecto(
    client: TestClient, demo: dict[str, str]
) -> None:
    code = client.post(SHARES, headers=demo).json()["code"]
    token = _claim(client, code)["token"]
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/ws/collab/prj_otro?link={token}") as ws,
    ):
        ws.receive_json()
    client.delete(f"{SHARES}/{code}", headers=demo)
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(f"{WS}?link={token}") as ws:
        ws.receive_json()
