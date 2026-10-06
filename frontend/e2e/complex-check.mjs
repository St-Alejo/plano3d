/**
 * Verificación visual del modelado complejo contra la app levantada (no corre en CI):
 *   node e2e/complex-check.mjs <base-url> <archivo> <carpeta-salida>
 * Sube el archivo (DXF, PDF o foto), espera el modelo y guarda capturas del editor 2D
 * (con cotas) y del visor 3D. Imprime errores de consola si los hay.
 */
import { chromium } from '@playwright/test'

const [base = 'http://localhost:5173', file, out = '.'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(`${base}/nuevo`)
await page.locator('input[type=file]').first().setInputFiles(file)
await page.getByRole('button', { name: /convertir a 3d/i }).click()
await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 })
const id = page.url().split('/p/')[1]
// espera a que el editor esté listo
await page.getByTestId('editor2d').waitFor({ timeout: 180_000 })
await page.waitForTimeout(1500)
const name = file.split(/[\\/]/).pop().replace(/\W+/g, '_')
await page.screenshot({ path: `${out}/editor_${name}.png` })
const res = await page.request.get(`${base}/api/projects/${id}`)
const body = await res.json()
const lv = body.model.levels[0]
const status = (lv.dimensions ?? []).reduce((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {})
console.log(
  JSON.stringify({
    walls: lv.walls.length,
    curved: lv.walls.filter((w) => w.bulge).length,
    rooms: lv.rooms.map((r) => `${r.label} ${r.area.toFixed(2)}`),
    columns: (lv.columns ?? []).length,
    stairs: (lv.stairs ?? []).length,
    dimensions: status,
    scale: body.model.scale.source,
  }),
)
await page.goto(`${base}/p/${id}/3d`)
await page.waitForTimeout(6000)
await page.screenshot({ path: `${out}/3d_${name}.png` })
console.log(errors.length ? `ERRORES: ${errors.join(' | ')}` : 'sin errores de consola')
await browser.close()
