"""Recrea la casa "Opción 3" de tres pisos en una API que esté corriendo.

    python scripts/demo_opc3.py [http://localhost:8000]

Sube el plano del piso 1 (tests/real/opc3p1), agrega el piso 2 (opc3p2), duplica el 2 como
piso 3, completa los muebles según el plano y deja la fachada contemporánea. Imprime el
enlace del visor 3D. Lee y escribe en UTF-8 (los nombres llevan tildes).
"""

import sys
import time
from pathlib import Path
from typing import Any

import httpx

REAL = Path(__file__).resolve().parents[1] / "tests" / "real"
VIEWER = "http://localhost:5173/p/{id}/3d"


def _ok(r: httpx.Response) -> dict[str, Any]:
    if r.status_code >= 400:
        raise SystemExit(f"{r.request.method} {r.request.url} → {r.status_code}: {r.text[:400]}")
    data: dict[str, Any] = r.json()
    return data


def _wait_ready(c: httpx.Client, pid: str, timeout: float = 180) -> dict[str, Any]:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        p = _ok(c.get(f"/api/projects/{pid}"))
        if p["status"] == "ready":
            return p
        if p["status"] == "failed":
            raise SystemExit(f"el proyecto {pid} falló: {p.get('error')}")
        time.sleep(1)
    raise SystemExit(f"el proyecto {pid} no terminó en {timeout:.0f} s")


def _if_match(p: dict[str, Any]) -> dict[str, str]:
    return {"If-Match": f'"{p["revision"]}"'}


def main(base: str) -> str:
    with httpx.Client(base_url=base, timeout=120) as c:
        pdf1 = (REAL / "opc3p1" / "plano.pdf").read_bytes()
        p = _ok(
            c.post(
                "/api/projects",
                data={"name": "Casa Opción 3 — tres pisos"},
                files={"file": ("opc3p1.pdf", pdf1, "application/pdf")},
            )
        )
        p = _wait_ready(c, p["id"])
        pid = p["id"]
        pdf2 = (REAL / "opc3p2" / "plano.pdf").read_bytes()
        p = _ok(
            c.post(
                f"/api/projects/{pid}/levels",
                data={"name": "Piso 2"},
                files={"file": ("opc3p2.pdf", pdf2, "application/pdf")},
                headers=_if_match(p),
            )
        )
        second = sorted(p["model"]["levels"], key=lambda lv: lv["elevation"])[-1]
        p = _ok(
            c.post(
                f"/api/projects/{pid}/levels/{second['id']}/duplicate",
                json={"name": "Piso 3"},
                headers=_if_match(p),
            )
        )
        p = _ok(c.post(f"/api/projects/{pid}/furnish", json={}, headers=_if_match(p)))
        p = _ok(
            c.put(
                f"/api/projects/{pid}/facade",
                json={"style": "moderna_contemporanea", "custom": None},
                headers=_if_match(p),
            )
        )
        for lv in sorted(p["model"]["levels"], key=lambda lv: lv["elevation"]):
            print(
                f"{lv['name']}: elevación {lv['elevation']:.2f} m, "
                f"{len(lv['rooms'])} ambientes, {len(lv.get('furniture') or [])} muebles"
            )
        print(f"fachada {p['model']['facade']}, revisión {p['revision']}")
        url = VIEWER.format(id=pid)
        print(url)
        return url


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000")
