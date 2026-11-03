"""Revisa el script de Blender del paquete de exportación.

    python scripts/check_blender_script.py [carpeta_del_paquete]

Siempre: compila el script y verifica que define lo que el paquete usa. Con una carpeta
(un .zip de "Exportar para Blender" descomprimido) y Blender instalado, además lo ejecuta
sin interfaz y revisa que deje ``casa.blend``.
"""

import ast
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "features"
    / "viewer3d"
    / "export"
    / "blender"
    / "arquitectura.py"
)
REQUIRED = {
    "main",
    "package_dir",
    "organize",
    "tune_materials",
    "cameras",
    "render_all",
    "register",
}


def check_source(path: Path = SCRIPT) -> list[str]:
    """Problemas del script (vacío = bien)."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    compile(tree, str(path), "exec")
    problems = []
    names = {n.name for n in tree.body if isinstance(n, ast.FunctionDef | ast.ClassDef)}
    if missing := REQUIRED - names:
        problems.append(f"faltan funciones: {sorted(missing)}")
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            # Blender necesita las anotaciones de bpy.props como objetos
            problems.append("no usar `from __future__ import ...`: rompe el registro del panel")
    return problems


def blender_exe() -> str | None:
    found = shutil.which("blender")
    if found:
        return found
    base = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Blender Foundation"
    exes = sorted(base.glob("Blender */blender.exe"), reverse=True) if base.is_dir() else []
    return str(exes[0]) if exes else None


def run_in_blender(folder: Path) -> None:
    exe = blender_exe()
    if exe is None:
        print("Blender no está instalado: se omite la ejecución")
        return
    glb = folder / "casa.glb"
    script = folder / "blender" / "arquitectura.py"
    cmd = [exe, "-b", "--factory-startup", "-P", str(script), "--", str(glb)]
    out = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False
    )
    if out.returncode != 0 or "Traceback" in out.stdout + out.stderr:
        raise SystemExit(f"Blender falló:\n{out.stdout[-3000:]}\n{out.stderr[-3000:]}")
    if not (folder / "casa.blend").is_file():
        raise SystemExit("Blender terminó pero no guardó casa.blend")
    print(next((ln for ln in out.stdout.splitlines() if ln.startswith("Plano 3D:")), "ok"))


if __name__ == "__main__":
    issues = check_source()
    if issues:
        raise SystemExit("\n".join(issues))
    print(f"{SCRIPT.name}: compila y define lo necesario")
    if len(sys.argv) > 1:
        run_in_blender(Path(sys.argv[1]))
