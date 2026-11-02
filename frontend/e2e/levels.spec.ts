/**
 * Selector de pisos del visor 3D: la ficha aparece al pasar el cursor, un clic aísla el piso
 * (los de encima se ocultan) y el chat también lo pide ("ver piso 2", "ver todos los pisos").
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

let projectId = ''

const wall = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  id,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness: 0.15,
  height: 2.6,
  openings: [],
  confidence: 1,
})
const room = (id: string, label: string, x0: number, y0: number, x1: number, y1: number) => ({
  id,
  label,
  confidence: 1,
  polygon: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
})
const box = (p: string, w: number, d: number) => [wall(`${p}1`, 0, 0, w, 0), wall(`${p}2`, w, 0, w, d), wall(`${p}3`, w, d, 0, d), wall(`${p}4`, 0, d, 0, 0)]

/** Casa de dos pisos: 8×6 abajo (sala y cocina) y 8×6 arriba (dos alcobas). */
async function makeHouse(request: APIRequestContext): Promise<string> {
  const p = (await (await request.post('/api/projects/blank', { data: { name: 'Pisos E2E' } })).json()) as {
    id: string
    revision: number
    model: Record<string, unknown>
  }
  const model = {
    ...p.model,
    levels: [
      {
        id: 'pb',
        name: 'Planta baja',
        elevation: 0,
        walls: [...box('b', 8, 6), wall('bm', 5, 0, 5, 6)],
        rooms: [room('r1', 'Sala', 0.08, 0.08, 4.92, 5.92), room('r2', 'Cocina', 5.08, 0.08, 7.92, 5.92)],
      },
      {
        id: 'pa',
        name: 'Planta alta',
        elevation: 2.7,
        walls: [...box('a', 8, 6), wall('am', 4, 0, 4, 6)],
        rooms: [room('r3', 'Alcoba 1', 0.08, 0.08, 3.92, 5.92), room('r4', 'Alcoba 2', 4.08, 0.08, 7.92, 5.92)],
      },
    ],
  }
  const put = await request.put(`/api/projects/${p.id}/model`, { data: model, headers: { 'If-Match': `"${p.revision}"` } })
  expect(put.ok(), await put.text()).toBe(true)
  return p.id
}

test.beforeAll(async ({ request }) => {
  projectId = await makeHouse(request)
})
test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('ficha al pasar el cursor, aislar un piso y volver al edificio', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d`)
  const rail = page.getByRole('navigation', { name: 'Pisos' })
  await expect(rail).toBeVisible()

  // el de arriba va arriba, como el edificio
  const bars = rail.getByRole('listitem')
  await expect(bars.first()).toContainText('Planta alta')
  await expect(bars.last()).toContainText('Planta baja')

  await rail.getByRole('button', { name: /Planta baja/ }).hover()
  const card = page.getByRole('group', { name: 'Ficha del piso 1' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('2 ')
  await expect(card).toContainText('m²')

  await card.getByRole('button', { name: 'Ver este piso' }).click()
  await expect(rail.getByRole('button', { name: /Planta baja/ })).toHaveAttribute('aria-pressed', 'true')
  await rail.getByRole('button', { name: 'Ver todo', exact: true }).click()
  await expect(rail.getByRole('button', { name: /Planta baja/ })).toHaveAttribute('aria-pressed', 'false')

  // el chat de la vista también elige pisos
  await page.getByRole('button', { name: 'Ajustar escribiendo' }).click()
  const input = page.getByRole('textbox', { name: 'Mensaje para la vista 3D' })
  await input.fill('ver piso 2')
  await input.press('Enter')
  await expect(rail.getByRole('button', { name: /Planta alta/ })).toHaveAttribute('aria-pressed', 'true')
  await input.fill('ver todos los pisos')
  await input.press('Enter')
  await expect(rail.getByRole('button', { name: /Planta alta/ })).toHaveAttribute('aria-pressed', 'false')

  expect(errors).toEqual([])
})
