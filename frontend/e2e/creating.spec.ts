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
