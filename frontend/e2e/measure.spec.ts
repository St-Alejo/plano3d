/** Fase 4 de punta a punta: cota de usuario persistente y cuadro de áreas exportable. */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test.skip(({ isMobile }) => isMobile, 'flujos de escritorio')

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))
let projectId = ''

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/projects', {
    multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) }, name: 'Cotas E2E' },
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

test('una cota dibujada se guarda y sigue ahí al recargar', async ({ page }) => {
  await page.goto(`/p/${projectId}`)
  await expect(page.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeVisible()
  await page.keyboard.press('a')
  await expect(page.getByRole('button', { name: /Acotar/ })).toHaveAttribute('aria-pressed', 'true')
  const box = (await page.getByTestId('editor2d').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: 'Cota', exact: true })).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()

  const saved = (await (await page.request.get(`/api/projects/${projectId}`)).json()) as {
    model: { levels: { dimensions: { source: string }[] }[] }
  }
  expect(saved.model.levels[0]!.dimensions.filter((d) => d.source === 'manual')).toHaveLength(1)

  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeVisible()
  await page.getByRole('tab', { name: 'Áreas' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('cuadro-de-areas-cotas-e2e.csv')
  const csv = readFileSync((await file.path())!, 'utf-8')
  expect(csv).toContain('Ambiente;Tipo;Área (m²)')
  expect(csv).toContain('Área útil total')
})
