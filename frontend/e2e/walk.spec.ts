/**
 * Recorrido con física: caminar, abrir una puerta, cambiar de piso (escritorio y celular).
 * El estado se lee de los atributos data- del HUD (posición, altura, piso, foco).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

let projectId = ''

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, openings: object[] = []) => ({
  id,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness: 0.15,
  height: 2.6,
  openings,
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

/**
 * Pasillo largo (8×2 m) que termina en una puerta hacia un cuarto con una escalera que sube
 * a una planta alta. Se arranca en el pasillo mirando hacia la puerta (la dirección más libre).
 */
async function makeHouse(request: APIRequestContext): Promise<string> {
  const p = (await (await request.post('/api/projects/blank', { data: { name: 'Recorrido E2E' } })).json()) as {
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
        walls: [
          wall('a', 0, 0, 12, 0),
          wall('b', 12, 0, 12, 2),
          wall('c', 12, 2, 0, 2),
          wall('d', 0, 2, 0, 0),
          wall('puerta', 8, 0, 8, 2, [{ id: 'op1', kind: 'door', offset: 0.55, width: 0.9, height: 2.1, sill: 0, confidence: 1 }]),
        ],
        rooms: [room('r1', 'A pasillo', 0.08, 0.08, 7.92, 1.92), room('r2', 'B cuarto', 8.08, 0.08, 11.92, 1.92)],
        stairs: [{ id: 'st', start: { x: 11.5, y: 1 }, end: { x: 8.5, y: 1 }, width: 0.9, steps: 15, riser: 0.18, base: 0, confidence: 1 }],
      },
      {
        id: 'pa',
        name: 'Planta alta',
        elevation: 2.7,
        walls: [wall('a2', 0, 0, 12, 0), wall('b2', 12, 0, 12, 2), wall('c2', 12, 2, 0, 2), wall('d2', 0, 2, 0, 0)],
        rooms: [],
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

const hud = (page: Page) => page.getByTestId('walk-hud')
const num = async (page: Page, attr: string) => Number(await hud(page).getAttribute(`data-${attr}`))

async function enterWalk(page: Page) {
  await page.goto(`/p/${projectId}/3d`)
  await page.getByRole('radio', { name: /Recorrer/ }).click()
  await expect(hud(page)).toHaveAttribute('data-level', 'pb')
  await page.getByRole('button', { name: 'Entendido' }).click()
}

test.describe('escritorio', () => {
  test.skip(({ isMobile }) => isMobile, 'flujo de escritorio')

  test('caminar, abrir la puerta con E y pasar; Q/Z cambian de piso', async ({ page }) => {
    await enterWalk(page)
    const x0 = await num(page, 'x')
    // se camina hacia la puerta: frena en la puerta cerrada y aparece "Abrir puerta"
    await page.keyboard.down('KeyW')
    await expect(hud(page)).toHaveAttribute('data-focus', 'door:op1', { timeout: 8000 })
    await page.waitForTimeout(1500)
    expect(await num(page, 'x')).toBeLessThan(8)
    expect(await num(page, 'y')).toBeCloseTo(0, 1)
    await page.keyboard.up('KeyW')
    await expect(page.getByRole('button', { name: /Abrir puerta/ })).toBeVisible()
    await page.keyboard.press('KeyE')
    await expect(page.getByRole('button', { name: /Cerrar puerta/ })).toBeVisible()
    await page.keyboard.down('KeyW')
    await expect.poll(() => num(page, 'x'), { timeout: 8000 }).toBeGreaterThan(8.3)
    await page.keyboard.up('KeyW')
    expect(await num(page, 'x')).toBeGreaterThan(x0)

    // cambio de piso por la escalera
    await page.keyboard.press('KeyQ')
    await expect(hud(page)).toHaveAttribute('data-level', 'pa')
    expect(await num(page, 'y')).toBeCloseTo(2.7, 1)
    await expect(page.getByText('Piso 2 de 2')).toBeVisible()
    await page.keyboard.press('KeyZ')
    await expect(hud(page)).toHaveAttribute('data-level', 'pb')
    expect(await num(page, 'y')).toBeCloseTo(0, 1)
  })
})

test.describe('celular', () => {
  test.skip(({ isMobile }) => !isMobile, 'solo celular')

  test('joystick para caminar, puertas automáticas y botones de piso', async ({ page }) => {
    await page.goto(`/p/${projectId}/3d`)
    await page.getByRole('radio', { name: /Recorrer/ }).click()
    await expect(page.getByText(/Camina con el joystick/)).toBeVisible()
    await page.getByRole('button', { name: 'Entendido' }).click()
    await expect(page.getByRole('button', { name: 'Puertas automáticas' })).toHaveAttribute('aria-pressed', 'true')

    const joy = (await page.getByRole('application', { name: 'Joystick para caminar' }).boundingBox())!
    const cx = joy.x + joy.width / 2
    const cy = joy.y + joy.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy - 30, { steps: 4 }) // adelante, sin correr
    // la puerta se abre sola al acercarse y se cruza sin tocar nada más
    await expect.poll(() => num(page, 'x'), { timeout: 15000 }).toBeGreaterThan(8.3)
    await page.mouse.up()

    await page.getByRole('button', { name: 'Subir un piso' }).click()
    await expect(page.getByText('Piso 2 de 2')).toBeVisible()
    await page.getByRole('button', { name: 'Bajar un piso' }).click()
    await expect(page.getByText('Piso 1 de 2')).toBeVisible()
  })
})
