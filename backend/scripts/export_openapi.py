"""Exporta el contrato OpenAPI al frontend: python scripts/export_openapi.py"""

import json
import sys
from pathlib import Path

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container

TARGET = Path(__file__).resolve().parents[2] / "frontend" / "src" / "api" / "openapi.json"


def spec() -> str:
    app = create_app(Settings(mode="memory"), container=memory_container())
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else TARGET
    out.write_text(spec(), encoding="utf-8")
    print(f"OpenAPI escrito en {out}")
