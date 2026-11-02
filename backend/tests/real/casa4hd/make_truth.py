"""Genera ``truth.json`` de casa4hd: OTRA foto de celular de la misma lámina que casa4
("PLANTA 2do PISO opc 3"), a resolución completa (2252x4000), con otra perspectiva.

Misma geometría que casa4 (el modelo levantado a mano); solo cambian las cuatro esquinas
exteriores del edificio medidas sobre esta foto. Dos fotos de la misma hoja sirven para
no ajustar la detección a una sola toma.
Uso: ``python tests/real/casa4hd/make_truth.py``.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent

#: sup-izq, sup-der, inf-der, inf-izq (px de ``plano.jpg``)
ESQUINAS = ((316.0, 346.0), (1885.0, 406.0), (2003.0, 3417.0), (352.0, 3459.0))

if __name__ == "__main__":
    base_path = HERE.parent / "casa4" / "make_truth.py"
    spec = importlib.util.spec_from_file_location("casa4_truth", base_path)
    assert spec and spec.loader
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    doc = (__doc__ or "").splitlines()
    base.main(ESQUINAS, HERE, doc[0] + " " + doc[1].strip())
