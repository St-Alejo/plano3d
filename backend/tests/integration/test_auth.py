"""Cuentas, sesiones, cuenta demo y acceso a proyectos (ADR-020), de punta a punta."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.demo import DEMO_PROJECT_ID, FEATURED_PROJECT_ID

SECRET = "x" * 40


def _settings(**kw: object) -> Settings:
    base: dict[str, object] = {
        "mode": "memory",
        "auth_required": True,
        "demo_enabled": True,
        "jwt_secret": SECRET,
        "snapshot": "none",
    }
    return Settings(**{**base, **kw})  # type: ignore[arg-type]


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(_settings(), container=memory_container())) as c:
        yield c


def _bearer(session: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


def _register(client: TestClient, email: str = "ana@ejemplo.co") -> dict[str, object]:
    r = client.post(
        "/api/auth/register", json={"email": email, "name": "Ana", "password": "clave-segura-1"}
    )
    assert r.status_code == 201, r.text
    body: dict[str, object] = r.json()
    return body


def test_sin_sesion_los_proyectos_piden_login(client: TestClient) -> None:
    r = client.get("/api/projects")
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/auth/config").json() == {"auth_required": True, "demo_enabled": True}


def test_registro_login_y_perfil(client: TestClient) -> None:
    session = _register(client, "  Ana@Ejemplo.CO ")
    assert session["user"] == {  # type: ignore[comparison-overlap]
        "id": session["user"]["id"],  # type: ignore[index]
        "email": "ana@ejemplo.co",
        "name": "Ana",
        "is_demo": False,
    }
    again = client.post(
        "/api/auth/register",
        json={"email": "ana@ejemplo.co", "name": "Otra", "password": "otra-clave-2"},
    )
    assert again.status_code == 409
    bad = client.post("/api/auth/login", json={"email": "ana@ejemplo.co", "password": "nop-nop-1"})
    assert bad.status_code == 401
    ok = client.post(
        "/api/auth/login", json={"email": "ANA@ejemplo.co", "password": "clave-segura-1"}
    ).json()
    assert client.get("/api/auth/me", headers=_bearer(ok)).json()["email"] == "ana@ejemplo.co"


def test_contrasena_corta_se_rechaza(client: TestClient) -> None:
    r = client.post(
        "/api/auth/register", json={"email": "b@ejemplo.co", "name": "B", "password": "corta"}
    )
    assert r.status_code == 422


def test_cada_cuenta_ve_solo_sus_proyectos(client: TestClient) -> None:
    ana, beto = _register(client, "ana@ejemplo.co"), _register(client, "beto@ejemplo.co")
    created = client.post("/api/projects/blank", json={"name": "Casa de Ana"}, headers=_bearer(ana))
    assert created.status_code == 201
    pid = created.json()["id"]
    assert [p["id"] for p in client.get("/api/projects", headers=_bearer(ana)).json()] == [pid]
    assert client.get("/api/projects", headers=_bearer(beto)).json() == []
    assert client.get(f"/api/projects/{pid}", headers=_bearer(beto)).status_code == 404
    assert client.delete(f"/api/projects/{pid}", headers=_bearer(beto)).status_code == 404
    assert client.get(f"/api/projects/{pid}", headers=_bearer(ana)).status_code == 200


def test_cuenta_demo_con_la_casa_de_tres_pisos(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    assert demo["user"]["is_demo"] is True
    projects = client.get("/api/projects", headers=_bearer(demo)).json()
    assert {p["id"] for p in projects} == {DEMO_PROJECT_ID, FEATURED_PROJECT_ID}
    project = client.get(f"/api/projects/{DEMO_PROJECT_ID}", headers=_bearer(demo)).json()
    levels = project["model"]["levels"]
    assert len(levels) == 3
    assert sum(len(lv.get("furniture") or []) for lv in levels) > 20
    image = client.get(f"/api/projects/{DEMO_PROJECT_ID}/image", headers=_bearer(demo))
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"


def test_restaurar_la_demo(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    assert (
        client.delete(f"/api/projects/{DEMO_PROJECT_ID}", headers=_bearer(demo)).status_code == 204
    )
    assert [p["id"] for p in client.get("/api/projects", headers=_bearer(demo)).json()] == [
        FEATURED_PROJECT_ID
    ]
    assert client.post("/api/auth/demo/reset", headers=_bearer(demo)).status_code == 204
    assert len(client.get("/api/projects", headers=_bearer(demo)).json()) == 2
    other = _register(client)
    assert client.post("/api/auth/demo/reset", headers=_bearer(other)).status_code == 403


def test_casa_destacada_se_ve_sin_cuenta(client: TestClient) -> None:
    featured = client.get("/api/featured").json()
    assert [f["id"] for f in featured] == [FEATURED_PROJECT_ID]
    casa = featured[0]
    assert casa["levels"] == 4 and casa["rooms"] > 30 and casa["total_area"] > 500
    assert casa["video"].endswith(".mp4")
    project = client.get(f"/api/featured/{FEATURED_PROJECT_ID}").json()
    levels = project["model"]["levels"]
    assert [lv["name"] for lv in levels] == ["Piso 1", "Piso 2", "Piso 3", "Azotea"]
    assert all(s["to_level_id"] for lv in levels[:3] for s in lv["stairs"])
    assert client.get("/api/featured/prj_otro").status_code == 404
    # sin cuenta solo se ve: el proyecto en sí sigue siendo de la demo
    assert client.get(f"/api/projects/{FEATURED_PROJECT_ID}").status_code == 401


def test_demo_deshabilitada() -> None:
    app = create_app(_settings(demo_enabled=False), container=memory_container())
    with TestClient(app) as c:
        assert c.post("/api/auth/demo").status_code == 404


def test_refresco_y_cierre_de_sesion_en_todos_lados(client: TestClient) -> None:
    session = _register(client)
    renewed = client.post("/api/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert renewed.status_code == 200
    # el de acceso no sirve como refresco
    wrong = client.post("/api/auth/refresh", json={"refresh_token": session["access_token"]})
    assert wrong.status_code == 401
    assert client.post("/api/auth/logout", headers=_bearer(session)).status_code == 204
    assert client.get("/api/auth/me", headers=_bearer(session)).status_code == 401
    old = client.post("/api/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert old.status_code == 401


def test_vincular_el_escritorio_con_un_codigo(client: TestClient) -> None:
    web = _register(client)
    code = client.post("/api/auth/link-codes", headers=_bearer(web)).json()
    assert len(code["code"]) == 6 and code["expires_in"] == 120
    desktop = client.post("/api/auth/link-codes/exchange", json={"code": code["code"].lower()})
    assert desktop.status_code == 200
    assert desktop.json()["user"]["id"] == web["user"]["id"]  # type: ignore[index]
    reused = client.post("/api/auth/link-codes/exchange", json={"code": code["code"]})
    assert reused.status_code == 401


def test_websocket_de_progreso_pide_ticket(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    from starlette.websockets import WebSocketDisconnect

    with (
        pytest.raises(WebSocketDisconnect) as closed,
        client.websocket_connect(f"/api/ws/projects/{DEMO_PROJECT_ID}"),
    ):
        pass
    assert closed.value.code == 4401
    ticket = client.post("/api/auth/ws-ticket", headers=_bearer(demo)).json()["ticket"]
    # el ticket de otra cuenta no abre el proyecto de la demo
    other = _register(client)
    other_ticket = client.post("/api/auth/ws-ticket", headers=_bearer(other)).json()["ticket"]
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/ws/projects/{DEMO_PROJECT_ID}?ticket={other_ticket}"),
    ):
        pass
    # el de la demo sí: el WS se acepta (y se cierra al no haber análisis en curso)
    client.post(f"/api/projects/{DEMO_PROJECT_ID}/reanalyze", headers=_bearer(demo))
    with client.websocket_connect(f"/api/ws/projects/{DEMO_PROJECT_ID}?ticket={ticket}") as ws:
        first = ws.receive_json()
        assert first["project_id"] == DEMO_PROJECT_ID


def test_login_con_fuerza_bruta_se_frena(client: TestClient) -> None:
    body = {"email": "nadie@ejemplo.co", "password": "x" * 10}
    codes = [client.post("/api/auth/login", json=body).status_code for _ in range(11)]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429


def test_recargar_muchas_veces_no_saca_de_la_sesion(client: TestClient) -> None:
    demo = client.post("/api/auth/demo").json()
    body = {"refresh_token": demo["refresh_token"]}
    codes = {client.post("/api/auth/refresh", json=body).status_code for _ in range(30)}
    assert codes == {200}
