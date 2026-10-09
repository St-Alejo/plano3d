/** Plano desde cero: se crea sin foto, se dibujan ambientes con el ratón y se guardan. */
import { expect, test, type Page } from '@playwright/test'

test.skip(({ isMobile }) => isMobile, 'flujos de escritorio')

const MPP = 0.01 // escala de los planos en blanco
let projectId = ''

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

/** Punto del plano (m) → pantalla, con la transformación real del lienzo. */
async function screenOf(page: Page, p: { x: number; y: number }) {
  const local = await page.evaluate(
    ({ x, y }) => {
      const k = (window as unknown as { Konva: { stages: { getAbsoluteTransform(): { point(p: object): { x: number; y: number } } }[] } }).Konva
      return k.stages[0]!.getAbsoluteTransform().point({ x, y })
    },
    { x: p.x / MPP, y: p.y / MPP },
  )
  const box = (await page.locator('[data-testid=editor2d] canvas').first().boundingBox())!
  return { x: box.x + local.x, y: box.y + local.y }
}

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  const pa = await screenOf(page, a)
  const pb = await screenOf(page, b)
  await page.mouse.move(pa.x, pa.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 10, pa.y + ((pb.y - pa.y) * i) / 10)
  await page.mouse.up()
}

test('empezar desde cero y dibujar dos ambientes con nombre', async ({ page }) => {
  await page.goto('/nuevo')
  await page.getByLabel('Nombre del plano').fill('Casa desde cero E2E')
  await page.getByRole('button', { name: 'Empezar desde cero' }).click()
  await expect(page).toHaveURL(/\/p\/prj_[a-z0-9]+\/estudio$/)
  projectId = page.url().split('/p/')[1]!.split('/')[0]!
  await expect(page.getByTestId('studio')).toBeVisible()
  // se dibuja con el ratón: el chat (abierto en planos en blanco) se cierra
  await page.getByRole('button', { name: 'Cerrar chat' }).click()
  await page.keyboard.press('1')
  await expect(page.locator('[data-testid=editor2d] canvas').first()).toBeVisible()

  await page.keyboard.press('h')
  await drag(page, { x: 1, y: 1 }, { x: 5, y: 6 })
  await page.getByLabel('Nombre del ambiente:').fill('Sala')
  await page.keyboard.press('Enter')

  await page.keyboard.press('h')
  await drag(page, { x: 5, y: 1 }, { x: 8, y: 4 })
  await page.getByLabel('Nombre del ambiente:').fill('Cocina')
  await page.keyboard.press('Enter')

  await page.keyboard.press('Control+s')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()

  const saved = (await (await page.request.get(`/api/projects/${projectId}`)).json()) as {
    has_source: boolean
    model: { levels: { walls: unknown[]; rooms: { label: string }[] }[] }
  }
  expect(saved.has_source).toBe(false)
  const lv = saved.model.levels[0]!
  expect(lv.walls).toHaveLength(7)
  expect(lv.rooms.map((r) => r.label).sort()).toEqual(['Cocina', 'Sala'])
})

test('dibujar una casa escribiendo en el chat', async ({ page, request }) => {
  const created = (await (await request.post('/api/projects/blank', { data: { name: 'Chat E2E' } })).json()) as { id: string }
  await page.goto(`/p/${created.id}/estudio`)
  const chat = page.getByRole('region', { name: 'Chat del plano' })
  await expect(chat).toBeVisible() // en un plano en blanco el chat arranca abierto
  const box = chat.getByRole('textbox', { name: 'Mensaje para el plano' })
  await box.fill('sala de 4x5, cocina de 3x3 al este de la sala con puerta al sur, puerta entre la sala y la cocina')
  await box.press('Enter')
  await expect(chat.getByText('Agregué una puerta entre Sala y Cocina')).toBeVisible()
  await box.fill('alcoba de 3x3 debajo de la sala con ventana al oeste')
  await box.press('Enter')
  await expect(chat.getByText('Dibujé Alcoba de 3 × 3 m')).toBeVisible()
  await page.screenshot({ path: 'test-results/estudio-chat.png' })

  await page.keyboard.press('Control+s')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()
  const saved = (await (await page.request.get(`/api/projects/${created.id}`)).json()) as {
    model: { levels: { walls: { openings: { kind: string }[] }[]; rooms: { label: string }[] }[] }
  }
  const lv = saved.model.levels[0]!
  expect(lv.rooms.map((r) => r.label).sort()).toEqual(['Alcoba', 'Cocina', 'Sala'])
  expect(lv.walls.flatMap((w) => w.openings.map((o) => o.kind)).sort()).toEqual(['door', 'door', 'window'])
  await request.delete(`/api/projects/${created.id}`)
})
