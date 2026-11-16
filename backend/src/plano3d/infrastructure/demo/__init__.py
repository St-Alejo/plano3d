"""Cuenta demo con la casa de 3 pisos (ADR-020).

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
DEMO_SUMMARY = "Casa de demostración"


def _manifest() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((DATA / "casa3.json").read_text(encoding="utf-8"))
    return data


def demo_project() -> tuple[Project, dict[str, bytes]]:
    """El proyecto demo tal como se generó, y sus archivos (clave → bytes)."""
    manifest = _manifest()
    model = model_from_dto(BuildingModelDTO.model_validate(manifest["model"]))
    files = {key: (DATA / name).read_bytes() for key, name in manifest["files"].items()}
    now = datetime.now(UTC)
    project = Project(
        id=DEMO_PROJECT_ID,
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
    if await container.repo.get(DEMO_PROJECT_ID) is None:
        await _put_project(container)
        log.info("Casa demo cargada (%s)", DEMO_PROJECT_ID)


async def reset_demo(container: Any) -> Project:
    """Deja la casa demo como recién generada (antes de presentar)."""
    await container.repo.delete(DEMO_PROJECT_ID)
    return await _put_project(container)


async def _put_project(container: Any) -> Project:
    project, files = demo_project()
    for key, data in files.items():
        media = "application/pdf" if key.endswith(".pdf") else "image/png"
        await container.storage.put(key, data, media)
    await container.repo.add(project)
    assert project.model is not None
    await container.repo.add_revision(
        ModelRevision(project.id, project.revision, project.model, DEMO_SUMMARY)
    )
    return project
