"""Genera la voz del video con las voces colombianas de Microsoft (edge-tts, sin cuenta).

Uso: python voces.py  →  assets/voice/{mujer,hombre}/lN.mp3 y lN.json (tiempos por palabra).
El guion va en voseo, como se habla en Medellín.
"""
import asyncio
import json
from pathlib import Path

import edge_tts

LINES = [
    '¿Tenés el plano de tu casa en papel? Tomale una foto, pues.',
    'La aplicación endereza la hoja y lee las cotas escritas.',
    'Después traza muros, puertas y ventanas, a escala.',
    'Y levanta los muros en 3D.',
    'Corregí lo que querás, y caminá tu casa por dentro.',
    'Del papel a tu casa en 3D. ¡Qué belleza!',
]
VOICES = {'mujer': 'es-CO-SalomeNeural', 'hombre': 'es-CO-GonzaloNeural'}
OUT = Path(__file__).parent / 'assets' / 'voice'


async def one(voice: str, text: str, mp3: Path) -> list[dict]:
    words = []
    com = edge_tts.Communicate(text, voice, rate='+4%', boundary='WordBoundary')
    with mp3.open('wb') as f:
        async for chunk in com.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                start = chunk['offset'] / 1e7
                words.append({'text': chunk['text'], 'start': round(start, 3), 'end': round(start + chunk['duration'] / 1e7, 3)})
    return words


async def main() -> None:
    for name, voice in VOICES.items():
        d = OUT / name
        d.mkdir(parents=True, exist_ok=True)
        for i, text in enumerate(LINES, 1):
            words = await one(voice, text, d / f'l{i}.mp3')
            (d / f'l{i}.json').write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding='utf-8')
            print(name, i, ' '.join(f"{w['text']}@{w['start']:.2f}" for w in words))


asyncio.run(main())
