/**
 * Convierte las imágenes originales (design/imagenes/*.png|jpg, fuera de public para no
 * publicarlas) a WebP en varios anchos: public/images/<nombre>-<ancho>.webp.
 * Uso: `npm run images`. Solo rehace las que cambiaron.
 */
import { readdir, stat, mkdir } from 'node:fs/promises'
import { join, parse } from 'node:path'
import sharp from 'sharp'

const SRC = 'design/imagenes'
const OUT = 'public/images'
const WIDTHS = [640, 1280, 1920]

await mkdir(OUT, { recursive: true })
// obra-*.png y *-fuente.png son fuentes: la página usa sus versiones alineadas (hero-NN-*.png)
const files = (await readdir(SRC)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith('obra-') && !/-fuente\.\w+$/.test(f))
for (const file of files) {
  const { name } = parse(file)
  const src = join(SRC, file)
  const srcTime = (await stat(src)).mtimeMs
  const meta = await sharp(src).metadata()
  for (const w of WIDTHS) {
    const out = join(OUT, `${name}-${w}.webp`)
    const done = await stat(out).catch(() => null)
    if (done && done.mtimeMs > srcTime) continue
    await sharp(src)
      .resize({ width: Math.min(w, meta.width ?? w), withoutEnlargement: true })
      .webp({ quality: w > 1000 ? 78 : 80, effort: 5 })
      .toFile(out)
    const kb = Math.round((await stat(out)).size / 1024)
    console.log(`${out}  ${kb} KB`)
  }
}
