"""WebSocket de edición en vivo de punta a punta (ADR-021)."""

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
URL = f"/api/ws/collab/{DEMO_PROJECT_ID}"


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(
        mode="memory", auth_required=True, demo_enabled=True, jwt_secret="k" * 40, snapshot="none"
    )
    with TestClient(create_app(settings, container=memory_container())) as c:
        yield c


def _auth(client: TestClient, session: Json) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


def _ticket(client: TestClient, session: Json) -> str:
    ticket: str = client.post("/api/auth/ws-ticket", headers=_auth(client, session)).json()[
        "ticket"
    ]
    return ticket


def _until(ws: Any, kind: str) -> Json:
    for _ in range(20):
        msg: Json = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"no llegó {kind}")


def test_dos_clientes_ven_el_mismo_cambio_y_rest_les_llega_entero(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    web_url = f"{URL}?ticket={_ticket(client, demo)}"
    desk_url = f"{URL}?ticket={_ticket(client, demo)}"
    with client.websocket_connect(web_url) as web, client.websocket_connect(desk_url) as desk:
        web.send_json({"type": "hello", "client": "web", "last_seq": None})
        welcome = _until(web, "welcome")
        assert welcome["you"]["name"] == "Cuenta demo" and welcome["seq"] == 0
        desk.send_json({"type": "hello", "client": "desktop", "last_seq": None})
        assert _until(desk, "welcome")["peers"][0]["client"] == "web"
        assert _until(web, "peer_joined")["peer"]["client"] == "desktop"

        level = welcome["model"]["levels"][0]
        furniture = copy.deepcopy(level["furniture"][0])
        furniture["position"]["x"] += 0.5
        op = {"t": "put", "k": "furniture", "level": level["id"], "id": furniture["id"]}
        desk.send_json({"type": "ops", "op_id": "d-1", "ops": [{**op, "v": furniture}]})
        applied = _until(web, "applied")
        assert applied["op_id"] == "d-1" and applied["seq"] == 1
        assert _until(desk, "applied")["op_id"] == "d-1"  # confirmación al autor

        desk.send_json({"type": "presence", "state": {"selection": furniture["id"]}})
        assert _until(web, "presence")["state"] == {"selection": furniture["id"]}
        web.send_json({"type": "ping"})
        assert _until(web, "pong") == {"type": "pong"}

        # una edición por REST guarda antes lo pendiente y llega a todos como modelo entero
        put = client.put(
            f"/api/projects/{DEMO_PROJECT_ID}/facade",
            json={"style": "moderna_ladrillo"},
            headers=_auth(client, demo),
        )
        assert put.status_code == 200, put.text
        assert put.json()["revision"] == 3  # 2 = lo de la sala, 3 = la fachada
        snap = _until(web, "snapshot")
        assert snap["model"]["facade"] == "moderna_ladrillo" and snap["revision"] == 3
        moved = next(
            f for f in snap["model"]["levels"][0]["furniture"] if f["id"] == furniture["id"]
        )
        assert moved["position"]["x"] == pytest.approx(furniture["position"]["x"])
        assert _until(desk, "snapshot")["revision"] == 3


def test_cambio_invalido_se_rechaza(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    with client.websocket_connect(f"{URL}?ticket={_ticket(client, demo)}") as ws:
        ws.send_json({"type": "hello", "client": "web"})
        _until(ws, "welcome")
        ws.send_json({"type": "ops", "op_id": "x", "ops": [{"t": "del", "k": "nada"}]})
        assert _until(ws, "reject")["op_id"] == "x"
        ws.send_text("no es json")
        assert _until(ws, "error")["reason"] == "JSON inválido"


def test_sin_ticket_o_con_el_de_otra_cuenta_no_entra(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect(URL) as ws:
        ws.receive_json()
    assert closed.value.code == 4401
    other = client.post(
        "/api/auth/register",
        json={"email": "otra@ejemplo.co", "name": "Otra", "password": "clave-segura-1"},
    ).json()
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        client.websocket_connect(f"{URL}?ticket={_ticket(client, other)}") as ws,
    ):
        ws.receive_json()
    assert closed.value.code == 4401


def test_el_primer_mensaje_debe_ser_el_saludo(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        client.websocket_connect(f"{URL}?ticket={_ticket(client, demo)}") as ws,
    ):
        ws.send_json({"type": "ops", "op_id": "a", "ops": []})
        ws.receive_json()
    assert closed.value.code == 4400


def test_borrar_el_proyecto_cierra_la_sala(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    with client.websocket_connect(f"{URL}?ticket={_ticket(client, demo)}") as ws:
        ws.send_json({"type": "hello", "client": "web"})
        _until(ws, "welcome")
        gone = client.delete(f"/api/projects/{DEMO_PROJECT_ID}", headers=_auth(client, demo))
        assert gone.status_code == 204
        assert _until(ws, "closed")["reason"] == "El proyecto se eliminó"


def test_leer_por_rest_con_la_sala_abierta_trae_lo_ultimo(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    with client.websocket_connect(f"{URL}?ticket={_ticket(client, demo)}") as ws:
        ws.send_json({"type": "hello", "client": "web"})
        model = _until(ws, "welcome")["model"]
        level = model["levels"][0]
        furniture = copy.deepcopy(level["furniture"][0])
        furniture["position"]["y"] += 0.75
        op = {"t": "put", "k": "furniture", "level": level["id"], "id": furniture["id"]}
        ws.send_json({"type": "ops", "op_id": "w-1", "ops": [{**op, "v": furniture}]})
        _until(ws, "applied")
        # sin esperar el guardado diferido (1,5 s): leer guarda antes lo pendiente
        got = client.get(f"/api/projects/{DEMO_PROJECT_ID}", headers=_auth(client, demo)).json()
        assert got["revision"] == 2
        moved = next(
            f for f in got["model"]["levels"][0]["furniture"] if f["id"] == furniture["id"]
        )
        assert moved["position"]["y"] == pytest.approx(furniture["position"]["y"])
        revisions = client.get(
            f"/api/projects/{DEMO_PROJECT_ID}/revisions", headers=_auth(client, demo)
        ).json()
        assert revisions[0]["summary"] == "Edición en vivo (web)"
        assert _until(ws, "saved")["revision"] == 2
