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

test('despiece de acero: cartilla, fila ↔ 3D y CSV para el ferretero', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d?modo=acero`)
  const steel = page.getByRole('region', { name: 'Despiece de acero' })
  await expect(steel.getByRole('list', { name: 'Acero por diámetro' })).toContainText('Total acero')
  // en acero no se ofrecen los controles de mampostería
  await expect(page.getByRole('combobox', { name: 'Unidad de mampostería' })).toHaveCount(0)

  // tocar una fila la marca y abre la ficha del elemento (que también se resalta en el 3D)
  const row = steel.getByRole('row').nth(1)
  const mark = (await row.getByRole('cell').first().textContent())!.trim()
  await row.click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('article', { name: 'Ficha del elemento' })).toContainText(mark.replace(/-[LE]$/, ''))

  const download = page.waitForEvent('download')
  await steel.getByRole('button', { name: 'Descargar despiece (CSV)' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^despiece-acero-.*\.csv$/)
  expect(errors).toEqual([])
})

test('secuencia de obra: recorre los pasos y se reproduce sin errores', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d?modo=secuencia`)
  const seq = page.getByRole('region', { name: 'Secuencia de obra' })
  const card = seq.getByRole('article', { name: 'Paso actual' })
  await expect(card).toContainText(/Paso 1 de \d+/)
  await expect(card).toContainText('Replanteo y excavación')
  const total = Number((await card.innerText()).match(/de (\d+)/)![1])

  await seq.getByRole('button', { name: 'Paso siguiente' }).click()
  await expect(card).toContainText(`Paso 2 de ${total}`)
  await expect(card).toContainText('Solado')
  await seq.getByRole('button', { name: 'Paso anterior' }).click()
  await expect(card).toContainText(`Paso 1 de ${total}`)

  // del último paso, reproducir vuelve a empezar y avanza solo
  await seq.getByRole('slider', { name: 'Paso de la obra' }).fill(String(total))
  await expect(card).toContainText(`Paso ${total} de ${total}`)
  await seq.getByRole('button', { name: 'Reproducir la obra' }).click()
  await expect(card).toContainText(/Paso [2-9] de/, { timeout: 15_000 })
  await seq.getByRole('button', { name: 'Pausar' }).click()
  await expect(seq.getByRole('button', { name: 'Reproducir la obra' })).toBeVisible()
  expect(errors).toEqual([])
})

test('cantidades de obra: totales, por etapa y CSV', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d?modo=obra`)
  await page.getByText('Cantidades de obra').click()
  const table = page.getByRole('table', { name: 'Cantidades' })
  await expect(table).toContainText('Ladrillo tolete')
  await expect(table).toContainText('bultos')
  // por etapa: solo lo de esa etapa
  await page.getByRole('combobox', { name: 'Qué comprar para' }).selectOption({ label: 'Solado de limpieza' })
  await expect(table).toContainText('Concreto del solado')
  await expect(table).not.toContainText('Ladrillo')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar cantidades (CSV)' }).click()
  expect((await download).suggestedFilename()).toMatch(/^cantidades-obra-.*\.csv$/)
  expect(errors).toEqual([])
})

test('láminas: detalles tipo en el 3D y capa de estructura en el editor', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/p/${projectId}/3d?modo=obra`)
  await page.getByText('Detalles tipo (secciones)').click()
  for (const name of ['Columneta', 'Viga de amarre', 'Viga de cimentación']) await expect(page.getByRole('img', { name: `Sección de ${name}` })).toBeVisible()

  await page.goto(`/p/${projectId}`)
  const show = page.getByRole('button', { name: 'Mostrar estructura (obra)' })
  await show.click()
  await expect(page.getByRole('button', { name: 'Ocultar estructura (obra)' })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
