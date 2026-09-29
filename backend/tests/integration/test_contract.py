"""El contrato OpenAPI que usa el frontend debe coincidir con la API real.

Si falla: `python scripts/export_openapi.py` y luego `npm run gen:api` en frontend/.
"""

from pathlib import Path

import pytest
from scripts.export_openapi import TARGET, spec


def test_frontend_contract_is_up_to_date() -> None:
    if not TARGET.exists():
        pytest.skip("frontend/ no está disponible (p. ej. dentro del contenedor del backend)")
    assert Path(TARGET).read_text(encoding="utf-8") == spec(), (
        "El contrato cambió: ejecuta scripts/export_openapi.py y npm run gen:api"
    )
