# Video «Cómo funciona» de la landing

Fuente de `public/tutoriales/como-funciona-{mujer,hombre}.mp4` (31 s, 1920×1080), hecho con HyperFrames
(HTML → video). Escenas en `compositions/`; la casa dibujada está en `assets/plan.js`.

- Voz: voces colombianas de Microsoft (`es-CO-SalomeNeural` mujer, `es-CO-GonzaloNeural` hombre)
  descargadas con `edge-tts` (sin cuenta ni pago) por `voces.py`; el guion va en voseo paisa.
  La primera versión con Kokoro quedó en `frontend/_old/video-landing-voz-kokoro`.
- Música: «Calming Background Music Guitar Loop» de Migfus20 (Freesound 560450), CC BY 4.0,
  https://freesound.org/people/Migfus20/sounds/560450
- Efectos (CC0, Freesound vía Openverse): obturador «Camera Shutter Click» de Kodack;
  barrido largo «Whoosh_Simple_ER_SFX_4» de Alex_hears_things; golpe «HUTCH HD SFX 2014 0144»
  de leonelmail. Barrido corto y pop: biblioteca de HyperFrames.
- Imágenes: las de `public/images` y la captura `public/landing/editor.jpg`.

Volver a generar: `python voces.py` (si cambia el guion) y `python variantes.py`, que pone cada voz
en `index.html`, renderiza y normaliza (−16 LUFS, limitador) a `public/tutoriales`.
`python variantes.py mujer` solo deja esa voz en `index.html` para abrir el Studio.
