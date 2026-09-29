// Captura de pantallas de referencia (no es un test): node e2e/screens.mjs <carpeta-salida>
import { chromium, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const out = process.argv[2] ?? 'test-results/screens'
const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const photo = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}/nuevo`)
await page.screenshot({ path: `${out}/01-nuevo.png` })
await page.getByTestId('file-input').setInputFiles(photo)
await page.getByLabel('Nombre del proyecto').fill('Depto de muestra')
await page.getByRole('button', { name: 'Ajustar esquinas' }).click()
await page.screenshot({ path: `${out}/02-esquinas.png` })
await page.getByRole('button', { name: 'Convertir a 3D' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${out}/03-procesando.png` })
await page.getByRole('toolbar').waitFor({ timeout: 90_000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/04-editor.png` })
const id = page.url().split('/p/')[1]
await page.goto(`${base}/p/${id}/3d`)
await page.waitForTimeout(3000)
await page.screenshot({ path: `${out}/05-orbitar.png` })
await page.getByRole('slider', { name: /Opacidad/ }).focus()
for (let i = 0; i < 6; i++) await page.keyboard.press('PageUp')
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/06-antes-despues.png` })
await page.goto(`${base}/`)
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/07-proyectos.png` })

const mobile = await browser.newPage({ ...devices['Pixel 7'] })
await mobile.goto(`${base}/p/${id}`)
await mobile.getByRole('tab', { name: 'Vista 3D' }).waitFor({ timeout: 30_000 })
await mobile.getByRole('tab', { name: 'Vista 3D' }).click()
await mobile.waitForTimeout(3000)
await mobile.screenshot({ path: `${out}/08-movil-3d.png` })
await browser.close()
console.log('capturas en', out, 'proyecto', id)
