"""Cuenta demo con la casa de 3 pisos, la Casa Mirador destacada y seis ejemplos (ADR-020).

Al arrancar la API se asegura de que existan la cuenta ``demo@plano3d.app`` y su proyecto
«Casa de 3 pisos» con un id fijo, cargados desde ``data/`` (generados una vez con
``python scripts/make_demo_fixture.py``). Es idempotente: si ya existen no los toca, así
lo que se edite en la presentación sobrevive mientras la API siga viva (o en la copia de
Blob). ``reset_demo`` los deja como nuevos.
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from plano3d.application.dto import BuildingModelDTO, model_from_dto
from plano3d.application.use_cases.auth import DEMO_EMAIL, DEMO_NAME
from plano3d.domain import ModelRevision, Project, ProjectStatus
from plano3d.domain.user import User

log = logging.getLogger(__name__)

DATA = Path(__file__).parent / "data"
DEMO_USER_ID = "usr_demo"
DEMO_PROJECT_ID = "prj_demo_casa3"
#: casa destacada (portada «Proyectos destacados»): se puede ver sin cuenta, solo lectura
FEATURED_PROJECT_ID = "prj_destacado_casa4"
DEMO_SUMMARY = "Casa de demostración"
#: proyecto → archivo de datos (generados con ``scripts/make_demo_fixture.py``)
#: ejemplos dibujados en metros (``scripts/demo_ejemplos.py``)
EXAMPLE_IDS = (
    "prj_ej_apto1",
    "prj_ej_apto2",
    "prj_ej_apto3",
    "prj_ej_campestre",
    "prj_ej_local",
    "prj_ej_duplex",
)
FIXTURES = {
    DEMO_PROJECT_ID: "casa3.json",
    FEATURED_PROJECT_ID: "casa4.json",
    **{pid: f"{pid.removeprefix('prj_')}.json" for pid in EXAMPLE_IDS},
}
FEATURED = (FEATURED_PROJECT_ID,)
#: textos y medios de cada destacado (los archivos viven en la web: public/destacados/)
FEATURED_INFO: dict[str, dict[str, str]] = {
    FEATURED_PROJECT_ID: {
        "summary": (
            "Casa moderna de 4 pisos: sala de doble frente al jardín, tres alcobas con baño, "
            "suite con vestier, sala de cine y azotea con BBQ, gimnasio y piscina."
        ),
        "cover": "/destacados/casa4/portada.webp",
        "video": "/destacados/casa4/recorrido.mp4",
    }
}


def _manifest(project_id: str = DEMO_PROJECT_ID) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((DATA / FIXTURES[project_id]).read_text(encoding="utf-8"))
    return data


def demo_project(project_id: str = DEMO_PROJECT_ID) -> tuple[Project, dict[str, bytes]]:
    """Un proyecto de la demo tal como se generó, y sus archivos (clave → bytes)."""
    manifest = _manifest(project_id)
    model = model_from_dto(BuildingModelDTO.model_validate(manifest["model"]))
    files = {key: (DATA / name).read_bytes() for key, name in manifest["files"].items()}
    now = datetime.now(UTC)
    project = Project(
        id=project_id,
        name=manifest["name"],
        original_image_key=manifest["original_image_key"],
        status=ProjectStatus.READY,
        model=model,
        revision=1,
        owner_id=DEMO_USER_ID,
        created_at=now,
        updated_at=now,
    )
    return project, files


async def seed_demo(container: Any, password: str = "") -> None:
    """Crea la cuenta y la casa demo si faltan (``container``: ``plano3d.container.Container``)."""
    if await container.users.get(DEMO_USER_ID) is None:
        secret = password or secrets.token_urlsafe(24)
        await container.users.add(
            User.create(
                DEMO_EMAIL,
                DEMO_NAME,
                container.hasher.hash(secret),
                user_id=DEMO_USER_ID,
                is_demo=True,
            )
        )
        log.info("Cuenta demo creada (%s)", DEMO_EMAIL)
    for project_id in FIXTURES:
        if await container.repo.get(project_id) is None:
            await _put_project(container, project_id)
            log.info("Proyecto demo cargado (%s)", project_id)


async def reset_demo(container: Any) -> Project:
    """Deja los proyectos demo como recién generados (antes de presentar); devuelve la casa."""
    for project_id in reversed(list(FIXTURES)):
        await container.repo.delete(project_id)
        project = await _put_project(container, project_id)
    return project


def featured_projects() -> list[Project]:
    """Los proyectos destacados tal como se generaron (para verlos sin cuenta)."""
    return [demo_project(pid)[0] for pid in FEATURED]


async def _put_project(container: Any, project_id: str = DEMO_PROJECT_ID) -> Project:
    project, files = demo_project(project_id)
    for key, data in files.items():
        media = "application/pdf" if key.endswith(".pdf") else "image/png"
        await container.storage.put(key, data, media)
    await container.repo.add(project)
    assert project.model is not None
    await container.repo.add_revision(
        ModelRevision(project.id, project.revision, project.model, DEMO_SUMMARY)
    )
    return project
