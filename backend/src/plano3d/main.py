"""Punto de entrada ASGI: ``uvicorn plano3d.main:app``."""

import logging

from plano3d.api.app import create_app
from plano3d.config import Settings

settings = Settings()
logging.basicConfig(
    level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
app = create_app(settings)
