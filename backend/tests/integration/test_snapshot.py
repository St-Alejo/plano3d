"""Copia del estado de la API en memoria: lo hecho sobrevive a un reinicio (ADR-020)."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.demo import DEMO_PROJECT_ID
from plano3d.infrastructure.memory import InMemoryProjectRepository, InMemoryUserRepository
from plano3d.infrastructure.snapshot import (
    FileSnapshotStore,
    Snapshotter,
    decode_state,
    encode_state,
)


def _settings(path: Path) -> Settings:
    return Settings(
        mode="memory",
        auth_required=True,
        demo_enabled=True,
        jwt_secret="s" * 40,
        snapshot="file",
        snapshot_file=path,
    )


def _bearer(session: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


def test_cuentas_proyectos_y_versiones_sobreviven_al_reinicio(tmp_path: Path) -> None:
    state = tmp_path / "state.json.gz"
    with TestClient(create_app(_settings(state), container=memory_container())) as c:
        ana = c.post(
            "/api/auth/register",
            json={"email": "ana@ejemplo.co", "name": "Ana", "password": "clave-segura-1"},
        ).json()
        pid = c.post("/api/projects/blank", json={"name": "Casa"}, headers=_bearer(ana)).json()[
            "id"
        ]
        demo = c.post("/api/auth/demo").json()
        model = c.get(f"/api/projects/{DEMO_PROJECT_ID}", headers=_bearer(demo)).json()["model"]
        model["levels"] = model["levels"][:2]
        saved = c.put(
            f"/api/projects/{DEMO_PROJECT_ID}/model?summary=Sin+azotea",
            json=model,
            headers=_bearer(demo),
        )
        assert saved.status_code == 200, saved.text
    assert state.exists()  # al apagar se sube la copia pendiente

    with TestClient(create_app(_settings(state), container=memory_container())) as c:
        again = c.post(
            "/api/auth/login", json={"email": "ana@ejemplo.co", "password": "clave-segura-1"}
        )
        assert again.status_code == 200
        mine = c.get("/api/projects", headers=_bearer(again.json())).json()
        assert [p["id"] for p in mine] == [pid]
        demo = c.post("/api/auth/demo").json()
        project = c.get(f"/api/projects/{DEMO_PROJECT_ID}", headers=_bearer(demo)).json()
        # la demo no se vuelve a sembrar encima de lo editado
        assert project["revision"] == 2
        assert len(project["model"]["levels"]) == 2
        history = c.get(f"/api/projects/{DEMO_PROJECT_ID}/revisions", headers=_bearer(demo))
        assert history.json()[0]["summary"] == "Sin azotea"


def test_ida_y_vuelta_exacta() -> None:
    async def run() -> None:
        container = memory_container()
        from plano3d.infrastructure.demo import seed_demo

        await seed_demo(container, "clave-demo-1")
        data = await encode_state(container.repo, container.users)
        repo, users = InMemoryProjectRepository(), InMemoryUserRepository()
        assert await decode_state(data, repo, users) == 1
        assert await repo.get(DEMO_PROJECT_ID) == await container.repo.get(DEMO_PROJECT_ID)
        assert await users.list() == await container.users.list()
        assert await repo.list_revisions(DEMO_PROJECT_ID) == await container.repo.list_revisions(
            DEMO_PROJECT_ID
        )
        assert await encode_state(repo, users) == data

    asyncio.run(run())


def test_rafagas_de_cambios_se_guardan_una_vez(tmp_path: Path) -> None:
    class CountingStore(FileSnapshotStore):
        saves = 0

        async def save(self, data: bytes) -> None:
            CountingStore.saves += 1
            await super().save(data)

    async def run() -> None:
        repo, users = InMemoryProjectRepository(), InMemoryUserRepository()
        snap = Snapshotter(repo, users, CountingStore(tmp_path / "s.gz"), delay_s=0.05)
        for _ in range(20):
            snap.mark_dirty()
        await asyncio.sleep(0.2)
        assert CountingStore.saves == 1
        await snap.aclose()  # nada pendiente: no vuelve a subir
        assert CountingStore.saves == 1

    asyncio.run(run())


def test_sin_copia_previa_arranca_en_limpio(tmp_path: Path) -> None:
    async def run() -> None:
        snap = Snapshotter(
            InMemoryProjectRepository(),
            InMemoryUserRepository(),
            FileSnapshotStore(tmp_path / "no-existe.gz"),
        )
        assert await snap.restore() == 0

    asyncio.run(run())
