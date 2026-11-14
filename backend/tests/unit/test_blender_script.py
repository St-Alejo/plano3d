"""El script de Blender del paquete de exportación compila y define lo que usa el paquete."""

from pathlib import Path

import pytest
from scripts.check_blender_script import SCRIPT, check_source


@pytest.mark.skipif(
    not SCRIPT.is_file(), reason="el script vive en el repo del frontend (plano3d-frontend)"
)
def test_el_script_de_blender_compila_y_esta_completo() -> None:
    assert check_source() == []


def test_detecta_el_import_de_future(tmp_path: Path) -> None:
    bad = tmp_path / "x.py"
    bad.write_text(
        "from __future__ import annotations\n\ndef main():\n    pass\n", encoding="utf-8"
    )
    problems = check_source(bad)
    assert any("__future__" in p for p in problems)
    assert any("faltan funciones" in p for p in problems)
