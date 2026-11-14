"""Fotos realistas con IA: el endpoint, el tope de gasto, la caché y los errores de OpenAI.

Nunca se llama a la API real: el generador es falso o el cliente HTTP es un transporte
simulado de httpx.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.application.ports import PhotoGenerator
from plano3d.application.use_cases.errors import PhotosUnavailableError
from plano3d.application.use_cases.photos import VIEWS, build_prompt
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.ocr.budget import ResponseCache
from plano3d.infrastructure.openai.images import ImageBudget, OpenAIPhotoGenerator, photo_cost

JPEG = b"\xff\xd8\xff\xe0" + b"captura" * 20
FOTO = b"\xff\xd8\xff\xe1foto"


class FakePhotos(PhotoGenerator):
    cost_per_photo = 0.02

    def __init__(self, left: float = 1.0, fail: set[str] | None = None) -> None:
        self.left = left
        self.fail = fail or set()
        self.prompts: list[str] = []

    async def generate(self, image: bytes, prompt: str) -> bytes:
        self.prompts.append(prompt)
        if any(VIEWS[v][1] in prompt for v in self.fail):
            raise PhotosUnavailableError("OpenAI está ocupado; intenta en un minuto")
        self.left -= self.cost_per_photo
        return FOTO

    def remaining_usd(self) -> float:
        return self.left


def _client(gen: PhotoGenerator | None) -> TestClient:
    c = memory_container()
    c.photos = gen
    return TestClient(create_app(Settings(mode="memory"), container=c))


def _send(client: TestClient, pid: str, views: list[str]) -> httpx.Response:
    return client.post(
        f"/api/projects/{pid}/photos",
        files=[("images", (f"{v}.jpg", JPEG, "image/jpeg")) for v in views],
        data={"views": ",".join(views), "facade": "Moderna blanca"},
    )


def test_cinco_fotos_desde_cinco_capturas() -> None:
    gen = FakePhotos()
    with _client(gen) as client:
        pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
        r = _send(client, pid, list(VIEWS))
        assert r.status_code == 200, r.text
        body = r.json()
        assert [p["view"] for p in body["photos"]] == list(VIEWS)
        assert body["photos"][3]["label"] == "De noche"
        assert (
            body["photos"][0]["image"]
            == "data:image/jpeg;base64," + base64.b64encode(FOTO).decode()
        )
        assert body["failed"] == 0
        assert body["remaining_usd"] == pytest.approx(0.9)
        assert all("Moderna blanca" in p for p in gen.prompts)


def test_si_una_vista_falla_llegan_las_demas() -> None:
    with _client(FakePhotos(fail={"noche"})) as client:
        pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
        r = _send(client, pid, ["calle", "noche"])
        assert r.status_code == 200, r.text
        assert [p["view"] for p in r.json()["photos"]] == ["calle"]
        assert r.json()["failed"] == 1


def test_si_todas_fallan_se_explica_el_motivo() -> None:
    with _client(FakePhotos(fail={"calle"})) as client:
        pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
        r = _send(client, pid, ["calle"])
        assert r.status_code == 503
        assert r.json()["detail"] == "OpenAI está ocupado; intenta en un minuto"


def test_sin_clave_o_sin_presupuesto_es_503_y_el_estado_lo_dice() -> None:
    with _client(None) as client:
        pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
        assert client.get("/api/photos/status").json()["available"] is False
        assert _send(client, pid, ["calle"]).status_code == 503
    with _client(FakePhotos(left=0.05)) as client:
        pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
        assert client.get("/api/photos/status").json()["available"] is True
        r = _send(client, pid, list(VIEWS))  # 5 x 0.02 > 0.05: no se gasta nada
        assert r.status_code == 503
        assert "presupuesto" in r.json()["detail"]


def test_capturas_invalidas() -> None:
    with _client(FakePhotos()) as client:
        pid = client.post("/api/projects/blank", json={"name": "Casa"}).json()["id"]
        assert _send(client, pid, ["piscina"]).status_code == 422
        assert _send(client, pid, ["calle"] * 6).status_code == 422
        r = client.post(
            f"/api/projects/{pid}/photos",
            files=[("images", ("x.txt", b"hola", "text/plain"))],
            data={"views": "calle"},
        )
        assert r.status_code == 422
        assert _send(client, "prj_noexiste", ["calle"]).status_code == 404


def test_la_instruccion_pide_conservar_la_geometria() -> None:
    p = build_prompt("noche", 3, "Moderna blanca")
    assert "mismo número de pisos" in p
    assert "3 pisos" in p
    assert "hora azul" in p
    assert "pisos" not in build_prompt("interior", 3, "").split("Foto de interiores")[1][:20]


# --- adaptador de OpenAI con transporte simulado ---

USAGE = {
    "input_tokens": 1107,
    "input_tokens_details": {"image_tokens": 950, "text_tokens": 157},
    "output_tokens": 158,
}


def _generator(
    tmp_path: Path, handler: httpx.MockTransport, limit: float = 1.0
) -> OpenAIPhotoGenerator:
    return OpenAIPhotoGenerator(
        http=httpx.AsyncClient(transport=handler),
        api_key="sk-prueba",
        budget=ImageBudget(tmp_path / "uso.json", limit_usd=limit),
        cache=ResponseCache(tmp_path / "cache"),
        retry_wait_s=0,
    )


async def test_adaptador_cobra_guarda_en_cache_y_no_repite(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        b64 = base64.b64encode(FOTO).decode()
        return httpx.Response(200, json={"data": [{"b64_json": b64}], "usage": USAGE})

    gen = _generator(tmp_path, httpx.MockTransport(handle))
    assert await gen.generate(JPEG, "casa") == FOTO
    assert await gen.generate(JPEG, "casa") == FOTO  # misma captura: de la caché
    assert len(calls) == 1
    sent = calls[0].content
    assert b'name="model"\r\n\r\ngpt-image-2' in sent
    assert b'name="quality"\r\n\r\nlow' in sent
    assert calls[0].headers["authorization"] == "Bearer sk-prueba"
    spent = json.loads((tmp_path / "uso.json").read_text())["spent_usd"]
    assert spent == pytest.approx(photo_cost("gpt-image-2", USAGE), abs=1e-6)
    assert 0.005 < spent < 0.02


async def test_adaptador_traduce_errores_y_reintenta_el_429(tmp_path: Path) -> None:
    replies = [
        httpx.Response(429, json={"error": {"code": "rate_limit_exceeded"}}),
        httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(FOTO).decode()}]}),
    ]
    gen = _generator(tmp_path, httpx.MockTransport(lambda _r: replies.pop(0)))
    assert await gen.generate(JPEG, "casa") == FOTO

    def quota(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"code": "insufficient_quota"}})

    gen = _generator(tmp_path, httpx.MockTransport(quota))
    with pytest.raises(PhotosUnavailableError, match="sin créditos"):
        await gen.generate(JPEG, "otra")

    def bad_key(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "Incorrect API key"}})

    gen = _generator(tmp_path, httpx.MockTransport(bad_key))
    with pytest.raises(PhotosUnavailableError, match="clave"):
        await gen.generate(JPEG, "otra más")


async def test_adaptador_no_gasta_sin_presupuesto(tmp_path: Path) -> None:
    def never(_r: httpx.Request) -> httpx.Response:
        raise AssertionError("no debía llamar a la API")

    gen = _generator(tmp_path, httpx.MockTransport(never), limit=0.01)
    with pytest.raises(PhotosUnavailableError, match="presupuesto"):
        await gen.generate(JPEG, "casa")
