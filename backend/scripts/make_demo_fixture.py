"""Genera los datos de la casa demo: python scripts/make_demo_fixture.py

Corre el mismo flujo que ``demo_opc3.py`` (plano del piso 1, piso 2, piso 3 duplicado,
muebles y fachada contemporánea) contra una API en memoria dentro del proceso y guarda el
resultado en ``src/plano3d/infrastructure/demo/data`` con el id fijo de la demo. La API la
carga de ahí al arrancar, sin volver a analizar los PDF.
"""

from __future__ import annotations

import json
import sys

from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.application.dto import model_to_dto
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.demo import DATA, DEMO_PROJECT_ID
from plano3d.infrastructure.memory import InMemoryFileStorage
from scripts.demo_opc3 import main as build_house

NAME = "Casa de 3 pisos"


def _rename(value: str, old: str) -> str:
    return value.replace(old, DEMO_PROJECT_ID)


def main() -> None:
    storage = InMemoryFileStorage()
    container = memory_container(storage)
    settings = Settings(mode="memory", auth_required=False, demo_enabled=False, snapshot="none")
    with TestClient(create_app(settings, container=container)) as client:
        client.timeout = 180
        pid = build_house("", client=client)
    import asyncio

    project = asyncio.run(container.repo.get(pid))
    assert project is not None and project.model is not None
    model = model_to_dto(project.model).model_dump(mode="json")
    model["project_id"] = DEMO_PROJECT_ID
    files: dict[str, str] = {}
    source = model.get("source_image")
    if source:
        source["key"] = _rename(source["key"], pid)
    keys = {
        project.original_image_key,
        *([source["key"].replace(DEMO_PROJECT_ID, pid)] if source else []),
    }
    for key in sorted(k for k in keys if k):
        data, _ = storage.files[key]
        name = "original.pdf" if key.endswith(".pdf") else "rectificada.png"
        (DATA / name).write_bytes(data)
        files[_rename(key, pid)] = name
    manifest = {
        "name": NAME,
        "original_image_key": _rename(project.original_image_key, pid),
        "files": files,
        "model": model,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "casa3.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    levels = model["levels"]
    print(f"{len(levels)} pisos, {sum(len(lv.get('furniture') or []) for lv in levels)} muebles")
    print(f"archivos: {files}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    main()
