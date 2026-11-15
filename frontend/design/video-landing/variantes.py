"""Pone la voz de mujer u hombre en index.html y renderiza las dos versiones del video.

Uso: python variantes.py            → render de las dos y copia a public/tutoriales
     python variantes.py mujer      → solo deja index.html con esa voz (para el Studio)

Cada frase empieza de modo que su palabra clave caiga en el mismo instante de la animación
(las dos voces hablan a distinto ritmo): «foto» 3,52 s, «endereza» 5,84, «muros» 11,0,
«levanta» 15,4, «Corregí» 20,4 y «Del papel» 26,0.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
PUBLIC = HERE.parent.parent / 'public' / 'tutoriales'
STARTS = {
    'mujer': [0.3, 5.02, 10.04, 15.16, 20.3, 25.9],
    'hombre': [0.6, 5.14, 10.16, 15.15, 20.3, 25.9],
}


def set_voice(name: str) -> None:
    index = HERE / 'index.html'
    clips = '\n'.join(
        f'      <audio id="vo-{i}" class="clip" src="assets/voice/{name}/l{i}.mp3" data-start="{t}" data-track-index="10" data-volume="1"></audio>'
        for i, t in enumerate(STARTS[name], 1)
    )
    html = index.read_text(encoding='utf-8')
    html = re.sub(r'<!-- voz:inicio -->.*?<!-- voz:fin -->', f'<!-- voz:inicio -->\n{clips}\n      <!-- voz:fin -->', html, flags=re.S)
    index.write_text(html, encoding='utf-8', newline='\n')


def render(name: str) -> None:
    raw = HERE / 'renders' / f'como-funciona-{name}.mp4'
    npx = shutil.which('npx') or 'npx'
    subprocess.run([npx, 'hyperframes', 'render', '-o', str(raw), '--crf', '26', '--keyframe-interval', '2', '--quiet'], cwd=HERE, check=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.8:level=false',
                    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(PUBLIC / f'como-funciona-{name}.mp4')], check=True)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        set_voice(sys.argv[1])
    else:
        for voice in ('hombre', 'mujer'):
            set_voice(voice)
            render(voice)
