/**
 * Flujo completo de punta a punta, contra el backend real:
 * foto → pipeline en vivo → editor 2D/3D → corrección → guardado → recorrido 3D → GLB.
 */
import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))

interface Pt {
  x: number
  y: number
}
interface ApiProject {
  model: {
    scale: { meters_per_pixel: number }
    source_image: { width_px: number; height_px: number }
    levels: { rooms: { id: string; label: string; centroid: Pt; area: number }[]; walls: unknown[] }[]
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

/** Convierte un punto del modelo (m) a coordenadas de pantalla del editor 2D (vista encuadrada). */
async function modelToScreen(page: Page, project: ApiProject, p: Pt): Promise<Pt> {
  const box = (await page.getByTestId('editor2d').boundingBox())!
  const { width_px: w, height_px: h } = project.model.source_image
  const s = Math.min(box.width / w, box.height / h) * 0.95
  const mpp = project.model.scale.meters_per_pixel
  return {
    x: box.x + (box.width - w * s) / 2 + (p.x / mpp) * s,
    y: box.y + (box.height - h * s) / 2 + (p.y / mpp) * s,
  }
}

test('de la foto de un plano a un modelo 3D recorrible', async ({ page }) => {
  const errors = collectErrors(page)

  // 1. Captura
  await page.goto('/nuevo')
  await page.getByTestId('file-input').setInputFiles(PHOTO)
  await page.getByLabel('Nombre del proyecto').fill('E2E Depto')
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()
  await expect(page).toHaveURL(/\/p\/prj_/)
  const projectId = page.url().split('/p/')[1]!

  // 2. Procesamiento en vivo → editor
  await expect(page.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('img', { name: 'Vista 3D del edificio' }).locator('canvas')).toBeVisible()

  // el modelo detectado tiene los 3 ambientes y 6 muros del plano
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()) as ApiProject
  const level = project.model.levels[0]!
  expect(level.rooms).toHaveLength(3)
  expect(level.walls).toHaveLength(6)

  // 3. Corrección: seleccionar un ambiente en el 2D y renombrarlo
  const room = level.rooms[0]!
  const at = await modelToScreen(page, project, room.centroid)
  await page.mouse.click(at.x, at.y)
  await expect(page.getByRole('heading', { name: 'Ambiente' })).toBeVisible()
  await page.getByLabel('Nombre').fill('Cocina E2E')
  await page.getByRole('button', { name: 'Renombrar' }).click()
  await expect(page.getByText('cambios sin guardar')).toBeVisible()

  // deshacer / rehacer con teclado
  await page.keyboard.press('Control+z')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+Shift+z')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()

  const saved = (await (await page.request.get(`/api/projects/${projectId}`)).json()) as ApiProject
  expect(saved.model.levels[0]!.rooms.find((r) => r.id === room.id)!.label).toBe('Cocina E2E')

  // 4. Recorrido 3D + exportación GLB
  await page.getByRole('link', { name: 'Recorrer' }).click()
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/3d$`))
  await expect(page.getByRole('img', { name: /Modelo 3D de E2E Depto/ }).locator('canvas')).toBeVisible()
  await page.getByRole('radio', { name: 'Recorrer' }).click()
  await expect(page.getByRole('button', { name: 'Clic para caminar' })).toBeVisible()
  await page.getByRole('button', { name: /Cocina E2E/ }).click()

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'GLB' }).click()])
  expect(download.suggestedFilename()).toBe('E2E_Depto.glb')
  const path = await download.path()
  const { statSync, readFileSync } = await import('node:fs')
  expect(statSync(path).size).toBeGreaterThan(2_000)
  expect(readFileSync(path).subarray(0, 4).toString()).toBe('glTF')

  await page.screenshot({ path: 'test-results/recorrido-3d.png' })
  expect(errors.filter((e) => !/Download the React DevTools/.test(e))).toEqual([])

  // limpieza
  await page.request.delete(`/api/projects/${projectId}`)
})

test('una imagen que no es un plano termina en error y ofrece reintentar', async ({ page }) => {
  await page.goto('/nuevo')
  await page.getByTestId('file-input').setInputFiles({
    name: 'blanco.png',
    mimeType: 'image/png',
    // PNG 1×1 blanco: no hay muros que detectar
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()
  await expect(page.getByText('No pudimos reconocer el plano')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await page.request.delete(`/api/projects/${page.url().split('/p/')[1]}`)
})
