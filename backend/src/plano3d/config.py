from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración por variables de entorno (prefijo ``PLANO3D_``).

    - ``memory``: todo en proceso (sin Postgres/Redis/S3). Ideal para desarrollo rápido y tests.
    - ``full``: Postgres + Redis (arq) + S3 (SeaweedFS local, S3/R2 en la nube).
      Es el modo de Docker Compose y producción.
    """

    model_config = SettingsConfigDict(env_prefix="PLANO3D_", env_file=".env", extra="ignore")

    mode: Literal["memory", "full"] = "memory"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]

    database_url: str = "postgresql+asyncpg://plano3d:plano3d@postgres:5432/plano3d"
    redis_url: str = "redis://redis:6379/0"

    storage: Literal["local", "s3"] = "local"
    storage_dir: Path = Path("./data")
    s3_bucket: str = "plano3d"
    s3_endpoint_url: str | None = "http://storage:8333"
    s3_access_key: str = "plano3d"
    s3_secret_key: str = "plano3d-secret"
    s3_region: str = "us-east-1"


#: variables que el SDK de Anthropic y el tope de gasto leen del entorno
_LOCAL_KEYS = ("ANTHROPIC_API_KEY", "PLANO3D_CLAUDE_BUDGET_USD", "PLANO3D_CLAUDE")


def load_local_env(path: Path | None = None) -> None:
    """Copia al entorno las credenciales de ``backend/.env`` (ignorado por git).

    Pydantic solo lee de ese archivo los campos ``PLANO3D_*`` de ``Settings``; el SDK de
    Anthropic busca su clave en el entorno del proceso. Nunca pisa variables ya definidas
    ni registra los valores.
    """
    env = path or Path(__file__).resolve().parents[2] / ".env"
    try:
        lines = env.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        key, sep, value = line.partition("=")
        key = key.strip()
        if sep and key in _LOCAL_KEYS and not line.lstrip().startswith("#"):
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))
