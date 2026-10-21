/** Calidad alta del visor: cielo HDRI, texturas PBR, oclusión ambiental y cubierta, sin errores. */
import { expect, test } from '@playwright/test'

test.skip(({ isMobile }) => isMobile, 'el celular arranca en calidad baja')

let projectId = ''

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, openings: object[] = []) => ({
  id,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness: 0.15,
  height: 2.6,
  material: 'plaster',
  openings,
  confidence: 1,
})

// casa de 8 × 5 m con una puerta y una ventana, sin pasar por la detección
test.beforeAll(async ({ request }) => {
  const p = (await (await request.post('/api/projects/blank', { data: { name: 'Realismo E2E' } })).json()) as { id: string; revision: number; model: Record<string, unknown> }
  const model = {
    ...p.model,
    levels: [
      {
        id: 'pb',
        name: 'Planta baja',
        elevation: 0,
        walls: [
          wall('a', 0, 0, 8, 0, [{ id: 'v1', kind: 'window', offset: 2, width: 1.2, height: 1.2, sill: 0.9, confidence: 1 }]),
          wall('b', 8, 0, 8, 5),
          wall('c', 8, 5, 0, 5, [{ id: 'p1', kind: 'door', offset: 3, width: 0.9, height: 2.1, sill: 0, confidence: 1 }]),
          wall('d', 0, 5, 0, 0),
        ],
        rooms: [{ id: 'r1', label: 'Sala', confidence: 1, polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }] }],
      },
    ],
  }
  const put = await request.put(`/api/projects/${p.id}/model`, { data: model, headers: { 'If-Match': `"${p.revision}"` } })
  expect(put.ok(), await put.text()).toBe(true)
  projectId = p.id
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${projectId}`)
})

test('calidad alta con texturas, cielo y cubierta; se recuerda al volver', async ({ page }) => {
  test.slow() // sin GPU el render por software tarda
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const assets: string[] = []
  page.on('response', (r) => {
    if (/\/(texturas|hdri)\//.test(r.url())) assets.push(`${r.status()} ${new URL(r.url()).pathname}`)
  })
  // sin GPU la página arrancaría en baja: se fija alta solo si aún no hay elección guardada
  await page.addInitScript(() => {
    if (!localStorage.getItem('plano3d-calidad')) localStorage.setItem('plano3d-calidad', 'alta')
  })
  await page.goto(`/p/${projectId}/3d`)
  const quality = page.getByRole('combobox', { name: 'Calidad' })
  await expect(quality).toHaveValue('alta')

  // se piden las fotos PBR y el cielo, y todas existen
  await expect.poll(() => assets.some((a) => a.includes('/hdri/cielo_1k.hdr')), { timeout: 30_000 }).toBe(true)
  await expect.poll(() => assets.some((a) => a.includes('/texturas/panete/color.webp')), { timeout: 30_000 }).toBe(true)
  expect(assets.filter((a) => !a.startsWith('200') && !a.startsWith('304'))).toEqual([])

  await page.getByRole('checkbox', { name: 'Cubierta (techo de teja)' }).check()
  await expect.poll(() => assets.some((a) => a.includes('/texturas/teja/')), { timeout: 30_000 }).toBe(true)

  await quality.selectOption('baja')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Calidad' })).toHaveValue('baja')
  expect(errors).toEqual([])
})
