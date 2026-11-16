"""Exporta el contrato a los clientes: python scripts/export_openapi.py

Escribe el OpenAPI en el frontend y copia los casos del contrato de ops (ADR-019) a la
web y al escritorio, porque cada cliente se publica en su propio repositorio.
"""

import json
import sys
from pathlib import Path

from plano3d.api.app import create_app
from plano3d.config import Settings
from plano3d.container import memory_container

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "frontend" / "src" / "api" / "openapi.json"
OPS_CASES = ROOT / "backend" / "tests" / "fixtures" / "ops" / "cases.json"
OPS_COPIES = (
    ROOT / "frontend" / "src" / "domain" / "__fixtures__" / "ops-cases.json",
    ROOT / "desktop" / "tests" / "Plano3D.Core.Tests" / "Fixtures" / "ops-cases.json",
)


def spec() -> str:
    app = create_app(Settings(mode="memory"), container=memory_container())
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else TARGET
    out.write_text(spec(), encoding="utf-8")
    print(f"OpenAPI escrito en {out}")
    for copy in OPS_COPIES:
        if copy.parent.parent.exists():
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.write_bytes(OPS_CASES.read_bytes())
            print(f"Casos de ops copiados a {copy}")
