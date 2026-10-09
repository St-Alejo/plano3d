/** Estudio: arrastrar una puerta a otro muro y borrar una ventana se guarda y vuelve al recargar. */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test.skip(({ isMobile }) => isMobile, 'flujos de escritorio')

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))
let projectId = ''

interface Op {
  id: string
  kind: string
  offset: number
}
interface W {
  id: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  openings: Op[]
}
interface Model {
  scale: { meters_per_pixel: number }
  levels: { walls: W[]; rooms: unknown[] }[]
}

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

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/projects', {
    multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) }, name: 'Edición E2E' },
  })
  projectId = ((await res.json()) as { id: string }).id
  for (let i = 0; i < 60; i++) {
    if (((await (await request.get(`/api/projects/${projectId}`)).json()) as { status: string }).status === 'ready') break
    await new Promise((r) => setTimeout(r, 500))
  }
  // modelo conocido: caja de 8×6 m con una puerta en el muro de abajo y una ventana arriba
  const model = ((await (await request.get(`/api/projects/${projectId}`)).json()) as { model: Model & { levels: object[] } }).model
  const level = model.levels[0] as object
  const put = await request.put(`/api/projects/${projectId}/model`, {
    headers: { 'If-Match': '*' },
    data: {
      ...model,
      levels: [
        {
          ...level,
          walls: [
            wall('w_top', 1, 1, 9, 1, [{ id: 'o_win', kind: 'window', offset: 3, width: 1.2, height: 1.2, sill: 0.9, confidence: 1 }]),
            wall('w_right', 9, 1, 9, 7),
            wall('w_bottom', 9, 7, 1, 7, [{ id: 'o_door', kind: 'door', offset: 2, width: 0.9, height: 2.1, sill: 0, confidence: 1 }]),
            wall('w_left', 1, 7, 1, 1),
          ],
          rooms: [],
          furniture: [],
          dimensions: [],
        },
      ],
    },
  })
  expect(put.ok()).toBe(true)
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${projectId}`)
})

/** Punto del plano (m) → coordenadas de pantalla, con la transformación real del lienzo de Konva. */
async function screenOf(page: Page, mpp: number, p: { x: number; y: number }) {
  const local = await page.evaluate(
    ({ x, y }) => {
      const k = (window as unknown as { Konva: { stages: { getAbsoluteTransform(): { point(p: object): { x: number; y: number } } }[] } }).Konva
      return k.stages[0]!.getAbsoluteTransform().point({ x, y })
    },
    { x: p.x / mpp, y: p.y / mpp },
  )
  const box = (await page.locator('[data-testid=editor2d] canvas').first().boundingBox())!
  return { x: box.x + local.x, y: box.y + local.y }
}

test('mover la puerta a otro muro y borrar la ventana', async ({ page }) => {
  await page.goto(`/p/${projectId}/estudio`)
  await expect(page.getByTestId('studio')).toBeVisible()
  await page.keyboard.press('1') // solo el plano
  await expect(page.locator('[data-testid=editor2d] canvas').first()).toBeVisible()
  const model = ((await (await page.request.get(`/api/projects/${projectId}`)).json()) as { model: Model }).model
  const mpp = model.scale.meters_per_pixel

  // la puerta (centro en x=9-2-0,45=6,55 sobre y=7) se arrastra al muro derecho (x=9, y≈3)
  const from = await screenOf(page, mpp, { x: 6.55, y: 7 })
  const to = await screenOf(page, mpp, { x: 9, y: 3 })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: 'Puerta' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Muro de la abertura' })).toHaveValue('w_right')

  // la ventana: clic y Supr
  const win = await screenOf(page, mpp, { x: 4.6, y: 1 })
  await page.mouse.click(win.x, win.y)
  await expect(page.getByRole('heading', { name: 'Ventana' })).toBeVisible()
  await page.keyboard.press('Delete')

  await page.keyboard.press('Control+s')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()

  const saved = ((await (await page.request.get(`/api/projects/${projectId}`)).json()) as { model: Model }).model
  const walls = saved.levels[0]!.walls
  const byId = (id: string) => walls.find((w) => w.id === id)!
  expect(byId('w_bottom').openings).toHaveLength(0)
  expect(byId('w_top').openings).toHaveLength(0)
  const door = byId('w_right').openings[0]!
  expect(door.id).toBe('o_door')
  expect(door.offset + 0.45).toBeGreaterThan(1.4) // el centro quedó cerca de y=3 (2 m desde el inicio)
  expect(door.offset + 0.45).toBeLessThan(2.6)
})
