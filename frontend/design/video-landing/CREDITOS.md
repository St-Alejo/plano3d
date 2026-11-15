# Video «Cómo funciona» de la landing

Fuente del video `public/tutoriales/como-funciona.mp4` (30 s, 1920×1080), hecho con HyperFrames
(HTML → video). Escenas en `compositions/`; la casa dibujada está en `assets/plan.js`.

- Voz: Kokoro-82M local (`npx hyperframes tts`, voz `ef_dora`, español). Sin servicios de pago.
- Efectos (CC0, Freesound vía Openverse): obturador «Camera Shutter Click» de Kodack;
  barrido largo «Whoosh_Simple_ER_SFX_4» de Alex_hears_things; golpe «HUTCH HD SFX 2014 0144»
  de leonelmail. Barrido corto y pop: biblioteca de HyperFrames.
- Imágenes: las de `public/images` y la captura `public/landing/editor.jpg`.

Volver a generar: `npx hyperframes render -o renders/como-funciona.mp4 --crf 26 --keyframe-interval 2`
y normalizar la voz con
`ffmpeg -i renders/como-funciona.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 128k -movflags +faststart ../../public/tutoriales/como-funciona.mp4`.
