"""Arma la carpeta ``pruebas/`` (raíz del repo) con planos listos para subir a Plano 3D.

- ``reales/``: planos reales del banco ``tests/real`` (los que la evaluación mide con verdad
  anotada); el pipeline los convierte bien.
- ``sinteticos/``: planos dibujados por el generador del banco de pruebas (CAD limpio,
  achurado, PDF vectorial con cotas y rótulo de escala).
- ``varios-pisos/``: las casas demo de 3 y 4 pisos, un PDF por piso.
- ``fotos/``: planos fotografiados (papel en ángulo, sombra, ruido, dobleces): así se ve un
  plano tomado con el celular.

Solo quedan los que el detector convierte bien; los estilos que todavía detecta mal se
dejaron fuera (ver comentarios abajo).

Con ``--verificar`` pasa cada archivo por el detector de producción e imprime lo que detecta
(muros, aberturas, ambientes) junto a lo esperado.

Uso (desde backend/):
    python scripts/generar_pruebas.py [--verificar]
"""

from __future__ import annotations

import argparse
import asyncio
import mimetypes
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from tests.synth.complex_plans import (  # noqa: E402
    Style,
    casa_compleja,
    multi_unit,
    render_complex,
)
from tests.synth.plan_generator import (  # noqa: E402
    SynthPlan,
    apartment,
    encode,
    l_house,
    photograph,
    render,
)
from tests.synth.to_pdf import plan_to_pdf  # noqa: E402

OUT = ROOT.parent / "pruebas"
REAL = ROOT / "tests" / "real"

#: caso real → nombre en la carpeta de pruebas. Fuera quedan ``casa3`` (tres plantas en una
#: sola imagen: IoU de ambientes 0,31) y ``planta2`` (sin verdad anotada).
REALES = {
    "casa1": "casa-1-planta",
    "casa2": "casa-2-planta",
    "casa4hd": "casa-4-planta-hd",
    "opc3p1": "casa-3-pisos-piso-1",
    "opc3p2": "casa-3-pisos-planta-tipo",
}


@dataclass(frozen=True)
class Esperado:
    muros: int
    aberturas: int
    ambientes: int


def _esperado(plan: SynthPlan) -> Esperado:
    return Esperado(len(plan.walls), plan.door_count + plan.window_count, len(plan.rooms))


def generar() -> dict[Path, Esperado | None]:
    if OUT.exists():
        for sub in ("reales", "sinteticos", "fotos", "varios-pisos"):
            shutil.rmtree(OUT / sub, ignore_errors=True)
    for sub in ("reales", "sinteticos", "fotos", "varios-pisos"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    salida: dict[Path, Esperado | None] = {}

    # 1. reales
    for caso, nombre in REALES.items():
        src = next((REAL / caso).glob("plano.*"))
        dst = OUT / "reales" / f"{nombre}{src.suffix}"
        shutil.copyfile(src, dst)
        salida[dst] = None

    # 1b. casas de varios pisos (un PDF por piso, se suben juntos por el chat de IA)
    for casa in ("casa3", "casa4"):
        src = ROOT.parent / "presentacion" / f"planos-{casa}"
        dst_dir = OUT / "varios-pisos" / f"{casa[:-1]}-{casa[-1]}-pisos"
        dst_dir.mkdir(parents=True, exist_ok=True)
        for pdf in sorted(src.glob("piso-*.pdf")):
            shutil.copyfile(pdf, dst_dir / pdf.name)
            salida[dst_dir / pdf.name] = None

    # 2. sintéticos simples (CAD limpio). La foto solo del apartamento: la de la casa en L
    #    pierde ambientes por la sombra.
    simples: dict[str, SynthPlan] = {"apartamento-3-ambientes": apartment(), "casa-en-L": l_house()}
    for nombre, plan in simples.items():
        r = render(plan, px_per_m=80)
        dst = OUT / "sinteticos" / f"{nombre}.png"
        dst.write_bytes(encode(r.image))
        salida[dst] = _esperado(plan)
        if nombre.startswith("apartamento"):
            foto = photograph(r, seed=7, tilt=0.06, shadow=0.3, fold=0.01)
            fdst = OUT / "fotos" / f"{nombre}-foto.jpg"
            fdst.write_bytes(encode(foto.image, ".jpg"))
            salida[fdst] = _esperado(plan)

    # 3. sintéticos complejos: el PDF vectorial es lo más fiel. De la casa compleja también el
    #    PNG con muros achurados y su foto. Quedan fuera (los detecta mal): boceto a mano, muros
    #    huecos, y el edificio en imagen (dobla los muros).
    casa = casa_compleja()
    for nombre, plan in {"casa-compleja": casa, "edificio-6-apartamentos": multi_unit(6)}.items():
        pdf = OUT / "sinteticos" / f"{nombre}.pdf"
        pdf.write_bytes(plan_to_pdf(plan))
        salida[pdf] = _esperado(plan)
    r = render_complex(casa, Style(walls="hatched"), px_per_m=70, seed=3)
    dst = OUT / "sinteticos" / "casa-compleja-achurada.png"
    dst.write_bytes(encode(r.image))
    salida[dst] = _esperado(casa)
    foto = photograph(render_complex(casa, Style(), px_per_m=70, seed=3), seed=11, tilt=0.07)
    fdst = OUT / "fotos" / "casa-compleja-foto.jpg"
    fdst.write_bytes(encode(foto.image, ".jpg"))
    salida[fdst] = _esperado(casa)
    return salida


async def verificar(archivos: dict[Path, Esperado | None]) -> None:
    from plano3d.application.dto import ProgressEventDTO
    from plano3d.application.ports import DetectionRequest, ProgressPublisher
    from plano3d.container import default_selector

    class _Quiet(ProgressPublisher):
        async def publish(self, event: ProgressEventDTO) -> None:
            return None

    selector = default_selector()
    print(f"{'archivo':52} {'muros':>11} {'aberturas':>11} {'ambientes':>11}")
    for path, esp in archivos.items():
        data = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        det = selector.choose(data, ctype)
        res = await det.detect(DetectionRequest(path.stem, data, ctype, None), _Quiet())
        lv = res.model.levels
        muros = sum(len(level.walls) for level in lv)
        aberturas = sum(len(w.openings) for level in lv for w in level.walls)
        ambientes = sum(len(level.rooms) for level in lv)

        def col(got: int, want: int | None) -> str:
            return f"{got}" if want is None else f"{got}/{want}"

        rel = path.relative_to(OUT).as_posix()
        print(
            f"{rel:52} {col(muros, esp and esp.muros):>11} "
            f"{col(aberturas, esp and esp.aberturas):>11} "
            f"{col(ambientes, esp and esp.ambientes):>11}"
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verificar", action="store_true")
    args = ap.parse_args()
    archivos = generar()
    print(f"{len(archivos)} archivos en {OUT}")
    if args.verificar:
        asyncio.run(verificar(archivos))


if __name__ == "__main__":
    main()
