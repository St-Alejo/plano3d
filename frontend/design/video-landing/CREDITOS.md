# Video «Cómo funciona» de la landing

Fuente de `public/tutoriales/como-funciona-{mujer,hombre}.mp4` (31 s, 1920×1080), hecho con HyperFrames
(HTML → video). Escenas en `compositions/`; la casa dibujada está en `assets/plan.js`.

- Voz: ElevenLabs (plan Starter, licencia comercial), voces de la biblioteca con acento paisa:
  «Lina - Colombian Warm & Confident» (`yfUfwZTRubVrsUZWqzwp`, mujer) y «Robert- Colombian-Paisa»
  (`AQkGeuTY47dqKKfZBMOO`, hombre), modelo `eleven_v4`; la frase 2 de Lina con
  `eleven_multilingual_v2`, porque `eleven_v4` decía «enveresa». Guion en voseo (ver `subs`).
  Los tiempos por palabra (`assets/voice/*/lN.json`) salen de Whisper `small`.
  Versiones anteriores en `frontend/_old`: Kokoro (`video-landing-voz-kokoro`) y edge-tts
  (`video-landing-voz-edge`, con su `voces.py`).
- Música: «Calming Background Music Guitar Loop» de Migfus20 (Freesound 560450), CC BY 4.0,
  https://freesound.org/people/Migfus20/sounds/560450
- Efectos (CC0, Freesound vía Openverse): obturador «Camera Shutter Click» de Kodack;
  barrido largo «Whoosh_Simple_ER_SFX_4» de Alex_hears_things; golpe «HUTCH HD SFX 2014 0144»
  de leonelmail. Barrido corto y pop: biblioteca de HyperFrames.
- Imágenes: las de `public/images` y la captura `public/landing/editor.jpg`.

Volver a generar: si cambia el guion, nuevas tomas en ElevenLabs y ajustar `STARTS`; luego `python variantes.py`, que pone cada voz
en `index.html`, renderiza y normaliza (−16 LUFS, limitador) a `public/tutoriales`.
`python variantes.py mujer` solo deja esa voz en `index.html` para abrir el Studio.
