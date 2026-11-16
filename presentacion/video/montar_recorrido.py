"""Monta el video del recorrido de la casa destacada con ffmpeg.

    python presentacion/video/montar_recorrido.py <carpeta-de-tomas> <salida.mp4>

La carpeta trae las tomas con estos nombres (las que falten se saltan):

- ``vuelta.mp4``: la vuelta exterior que graba ``arquitectura.py --vuelta`` en Blender;
- ``fachada.png``: la fachada al atardecer;
- ``casa4-<ambiente>.png``: los interiores renderizados en Interiores (Blender, 16:9);
- ``<ambiente>.mp4``: si existe, un clip (por ejemplo de Higgsfield) que reemplaza la foto.

Cada foto se mueve despacio (acercamiento con un leve paneo) y lleva su rótulo; las tomas se
encadenan con fundidos. Sale en 1920x1080, 30 fps, H.264, listo para la web.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

W, H, FPS = 1920, 1080, 30
STILL = 4.2  # segundos por foto
FADE = 0.7
FONT = "C\\:/Windows/Fonts/segoeui.ttf"

#: orden del recorrido: de la calle a la azotea, piso por piso
SHOTS = [
    ("vuelta", "Casa Mirador · 4 pisos"),
    ("fachada", "Fachada al atardecer"),
    ("casa4-sala", "Piso 1 · Sala doble altura"),
    ("casa4-cocina", "Piso 1 · Cocina abierta"),
    ("casa4-comedor", "Piso 1 · Comedor de nogal"),
    ("casa4-alcoba2", "Piso 2 · Alcoba con vista a la calle"),
    ("casa4-suite", "Piso 3 · Suite principal"),
    ("casa4-bano-suite", "Piso 3 · Baño de la suite"),
    ("casa4-estudio", "Piso 3 · Estudio principal"),
    ("casa4-cine", "Piso 3 · Sala de cine"),
]


def _title(text: str) -> str:
    safe = text.replace(":", "\\:").replace("'", "’")
    return (
        f"drawtext=fontfile='{FONT}':text='{safe}':fontsize=46:fontcolor=white:"
        f"x=80:y=h-140:shadowcolor=black@0.55:shadowx=2:shadowy=2:"
        f"alpha='min(1,max(0,(t-0.4)/0.6))'"
    )


def _probe_seconds(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


def build(folder: Path, out: Path) -> None:
    inputs: list[str] = []
    chains: list[str] = []
    lengths: list[float] = []
    for name, title in SHOTS:
        clip, still = folder / f"{name}.mp4", folder / f"{name}.png"
        i = len(lengths)
        if clip.exists():
            inputs += ["-i", str(clip)]
            seconds = _probe_seconds(clip)
            chains.append(
                f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                f"fps={FPS},format=yuv420p,setpts=PTS-STARTPTS,{_title(title)}[v{i}]"
            )
        elif still.exists():
            inputs += ["-loop", "1", "-t", f"{STILL}", "-i", str(still)]
            seconds = STILL
            frames = round(STILL * FPS)
            # acercamiento lento del 100 al 110 % con un paneo suave hacia la derecha
            chains.append(
                f"[{i}:v]scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
                f"zoompan=z='1+0.10*on/{frames}':x='(iw-iw/zoom)*(0.35+0.3*on/{frames})':"
                f"y='(ih-ih/zoom)/2':d={frames}:s={W}x{H}:fps={FPS},"
                f"format=yuv420p,setpts=PTS-STARTPTS,{_title(title)}[v{i}]"
            )
        else:
            print(f"falta {name}: se salta")
            continue
        lengths.append(seconds)
    if not lengths:
        raise SystemExit("No hay tomas en la carpeta")
    # fundidos encadenados
    last, offset = "v0", 0.0
    for k in range(1, len(lengths)):
        offset += lengths[k - 1] - FADE
        label = f"x{k}"
        chains.append(
            f"[{last}][v{k}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[{label}]"
        )
        last = label
    chains.append(
        f"[{last}]fade=t=in:st=0:d=0.8,fade=t=out:st={offset + lengths[-1] - 1.0:.3f}:d=1.0[out]"
    )
    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", ";".join(chains),
        "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out),
    ]  # fmt: skip
    subprocess.run(cmd, check=True)
    print(f"listo: {out} ({offset + lengths[-1]:.1f} s)")


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]))
