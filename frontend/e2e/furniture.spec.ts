/** Fase 5 de punta a punta: muebles y acabados se guardan en el modelo y vuelven al recargar. */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test.skip(({ isMobile }) => isMobile, 'flujos de escritorio')

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))
let projectId = ''

interface Saved {
  model: {
    levels: {
      furniture?: { catalog_id: string; rotation: number }[]
      walls: { material: string }[]
      rooms: { floor_material?: string | null }[]
    }[]
  }
}

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/projects', {
    multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) }, name: 'Muebles E2E' },
  })
  projectId = ((await res.json()) as { id: string }).id
  for (let i = 0; i < 60; i++) {
    if (((await (await request.get(`/api/projects/${projectId}`)).json()) as { status: string }).status === 'ready') return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('no terminó el análisis')
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${projectId}`)
})

test('agregar, girar y pintar se guardan y sobreviven a recargar', async ({ page }) => {
  await page.goto(`/p/${projectId}`)
  await expect(page.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeVisible()

  await page.getByRole('button', { name: 'Agregar Sofá de 3 puestos' }).click()
  await expect(page.getByRole('heading', { name: 'Mueble', exact: true })).toBeVisible()
  await page.keyboard.press('r')

  // pincel: piso de porcelanato sobre el ambiente detectado (centro del lienzo)
  await page.getByRole('combobox', { name: 'Pisos' }).selectOption('porcelanato')
  await page.keyboard.press('p')
  const box = (await page.getByTestId('editor2d').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62)

  await page.keyboard.press('Control+s')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()

  const saved = (await (await page.request.get(`/api/projects/${projectId}`)).json()) as Saved
  const lv = saved.model.levels[0]!
  expect(lv.furniture).toHaveLength(1)
  expect(lv.furniture![0]!.catalog_id).toBe('sofa_3')
  expect(lv.furniture![0]!.rotation).toBeCloseTo(Math.PI / 2)

  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Capas' }).getByText('Mobiliario')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ocultar mobiliario' })).toBeVisible()
})
