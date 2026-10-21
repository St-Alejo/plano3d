/** Modos del plano: Obra (maestro) muestra el esqueleto, la leyenda y la ficha de cada elemento. */
import { expect, test } from '@playwright/test'

test.skip(({ isMobile }) => isMobile, 'el panel de obra se prueba en escritorio')

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
  const p = (await (await request.post('/api/projects/blank', { data: { name: 'Obra E2E' } })).json()) as { id: string; revision: number; model: Record<string, unknown> }
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

test('modo obra: selector, enlace, leyenda y ficha al tocar un elemento', async ({ page }) => {
  test.slow() // miles de ladrillos con render por software
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d`)
  await page.getByRole('radio', { name: 'Obra (maestro)' }).click()
  await expect(page).toHaveURL(/modo=obra/)

  const obra = page.getByRole('region', { name: 'Obra' })
  await expect(obra.getByRole('list', { name: 'Leyenda' })).toContainText('Columneta')
  await expect(obra).toContainText('no reemplaza el diseño firmado por un ingeniero')
  // en obra no se ofrece la cubierta de teja
  await expect(page.getByRole('checkbox', { name: 'Cubierta (techo de teja)' })).toHaveCount(0)

  // vista en planta: tocar sobre los muros hasta dar con un elemento (ladrillo, viga o columneta)
  await page.getByRole('button', { name: 'Planta', exact: true }).click()
  const canvas = page.locator('canvas').first()
  const box = (await canvas.boundingBox())!
  const card = page.getByRole('article', { name: 'Ficha del elemento' })
  found: for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75]) {
    for (const fx of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      await canvas.click({ position: { x: box.width * fx, y: box.height * fy } })
      if (await card.isVisible()) break found
    }
  }
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading')).toHaveText(/Columneta|Viga|Muro|Dintel|Sobrecimiento|Placa|Tabique/)

  // ocultar la mampostería y cambiar a bloque no rompe la escena
  await obra.getByRole('checkbox', { name: /Ocultar mampostería/ }).check()
  await obra.getByRole('combobox', { name: 'Unidad de mampostería' }).selectOption('bloque5')

  // el enlace con ?modo=obra abre directo en obra
  await page.reload()
  await expect(page.getByRole('region', { name: 'Obra' })).toBeVisible()
  expect(errors).toEqual([])
})
