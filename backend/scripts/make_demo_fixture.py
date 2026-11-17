"""Genera los datos de la cuenta demo: python scripts/make_demo_fixture.py [casa3|casa4|ejemplos]

``casa3`` (por defecto) es la casa de 3 pisos; ``casa4`` la Casa Mirador destacada de 4 pisos
(``demo_casa4.py``, sin archivos: se dibuja en metros, no sale de un plano subido);
``ejemplos`` los seis proyectos de ``demo_ejemplos.py`` (apartamentos, campestre, local, dúplex).

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
from plano3d.infrastructure.demo import DATA, DEMO_PROJECT_ID, FEATURED_PROJECT_ID
from plano3d.infrastructure.memory import InMemoryFileStorage
from scripts import demo_casa4, demo_ejemplos, demo_opc3

#: casa → (generador, id fijo, nombre, archivo)
HOUSES = {
    "casa3": (demo_opc3.main, DEMO_PROJECT_ID, "Casa de 3 pisos", "casa3.json"),
    "casa4": (demo_casa4.main, FEATURED_PROJECT_ID, demo_casa4.NAME, "casa4.json"),
}


def main(which: str = "casa3") -> None:
    build_house, fixed_id, name, out = HOUSES[which]

    def _rename(value: str, old: str) -> str:
        return value.replace(old, fixed_id)

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
    model["project_id"] = fixed_id
    files: dict[str, str] = {}
    source = model.get("source_image")
    if source:
        source["key"] = _rename(source["key"], pid)
    keys = {
        project.original_image_key,
        *([source["key"].replace(fixed_id, pid)] if source else []),
    }
    for key in sorted(k for k in keys if k and k in storage.files):
        data, _ = storage.files[key]
        name = "original.pdf" if key.endswith(".pdf") else "rectificada.png"
        (DATA / name).write_bytes(data)
        files[_rename(key, pid)] = name
    manifest = {
        "name": name,
        "original_image_key": _rename(project.original_image_key, pid),
        "files": files,
        "model": model,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / out).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    levels = model["levels"]
    print(f"{len(levels)} pisos, {sum(len(lv.get('furniture') or []) for lv in levels)} muebles")
    print(f"archivos: {files}")


def examples() -> None:
    """Los ejemplos de ``demo_ejemplos.py``, cada uno en ``data/<id sin prj_>.json``."""
    import asyncio

    container = memory_container(InMemoryFileStorage())
    settings = Settings(mode="memory", auth_required=False, demo_enabled=False, snapshot="none")
    with TestClient(create_app(settings, container=container)) as client:
        created = demo_ejemplos.main("", client=client)
    for fixed_id, pid in created.items():
        project = asyncio.run(container.repo.get(pid))
        assert project is not None and project.model is not None
        model = model_to_dto(project.model).model_dump(mode="json")
        model["project_id"] = fixed_id
        manifest = {"name": project.name, "original_image_key": "", "files": {}, "model": model}
        out = DATA / f"{fixed_id.removeprefix('prj_')}.json"
        out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{out.name}: {project.name}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    which = sys.argv[1] if len(sys.argv) > 1 else "casa3"
    examples() if which == "ejemplos" else main(which)
