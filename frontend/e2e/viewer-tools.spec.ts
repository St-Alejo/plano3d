/** Fase 6 de punta a punta: herramientas de análisis del visor 3D y exportaciones. */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test.skip(({ isMobile }) => isMobile, 'flujos de escritorio')

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))
let projectId = ''

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/projects', {
    multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) }, name: 'Visor E2E' },
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

test('sol, corte, vistas, medir y exportar sin errores', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d`)
  await expect(page.getByRole('radio', { name: 'Orbitar' })).toBeVisible()

  const sun = page.getByRole('region', { name: 'Estudio solar' })
  await sun.getByRole('checkbox').check()
  await expect(sun.getByText(/altura \d+° · azimut \d+°/)).toBeVisible()
  await sun.getByRole('slider', { name: 'Hora del día' }).focus()
  await page.keyboard.press('End')
  await expect(sun.getByText('19:00')).toBeVisible()

  const cut = page.getByRole('region', { name: 'Corte de sección' })
  await cut.getByRole('checkbox').check()
  await expect(cut.getByText('1.20 m')).toBeVisible()

  await page.getByRole('group', { name: 'Encuadre' }).getByRole('button', { name: 'Planta' }).click()
  await page.getByRole('combobox', { name: 'Visualización' }).selectOption('xray')

  // medir: dos clics sobre el modelo, vistos desde la planta
  await page.getByRole('button', { name: 'Medir' }).click()
  await page.waitForTimeout(800)
  const canvas = (await page.locator('canvas').first().boundingBox())!
  await page.mouse.click(canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.5)
  await page.mouse.click(canvas.x + canvas.width * 0.58, canvas.y + canvas.height * 0.5)
  await expect(page.getByRole('status').filter({ hasText: / m$/ })).toBeVisible()

  const png = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Guardar imagen PNG' }).click()
  expect((await png).suggestedFilename()).toBe('Visor_E2E.png')

  const obj = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar modelo OBJ' }).click()
  const file = await obj
  expect(file.suggestedFilename()).toBe('Visor_E2E.obj')
  expect(readFileSync((await file.path())!, 'utf-8')).toMatch(/^v /m)

  expect(errors).toEqual([])
})
