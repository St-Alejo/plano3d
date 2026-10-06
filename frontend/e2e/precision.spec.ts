/**
 * Fase A de punta a punta: precisión, topología, ambientes derivados, versiones y concurrencia.
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test.skip(({ isMobile }) => isMobile, 'flujos de escritorio')

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))

interface Pt {
  x: number
  y: number
}
interface ApiWall {
  id: string
  start: Pt
  end: Pt
}
interface ApiProject {
  revision: number
  model: {
    scale: { meters_per_pixel: number }
    source_image: { width_px: number; height_px: number }
    levels: { walls: ApiWall[]; rooms: { id: string; label: string; area: number }[] }[]
  }
}

let projectId = ''

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/projects', {
    multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) }, name: 'Precisión E2E' },
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

const getProject = async (page: Page) => (await (await page.request.get(`/api/projects/${projectId}`)).json()) as ApiProject
const walls = (p: ApiProject) => p.model.levels[0]!.walls
const topWall = (p: ApiProject) => [...walls(p)].sort((a, b) => a.start.y + a.end.y - (b.start.y + b.end.y))[0]!
const near = (a: Pt, b: Pt, tol = 0.02) => Math.hypot(a.x - b.x, a.y - b.y) <= tol

async function openEditor(page: Page) {
  await page.goto(`/p/${projectId}`)
  await expect(page.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeVisible()
}

async function selectWall(page: Page, id: string) {
  const p = await getProject(page)
  const index = walls(p).findIndex((w) => w.id === id)
  await page.getByRole('region', { name: 'Muros' }).getByRole('button').nth(index).click()
  await expect(page.getByRole('heading', { name: 'Muro' })).toBeVisible()
}

test('largo exacto: la esquina se arrastra, los ambientes se recalculan y queda una versión nueva', async ({ page }) => {
  await openEditor(page)
  const before = await getProject(page)
  const top = topWall(before)
  const areaBefore = before.model.levels[0]!.rooms.reduce((s, r) => s + r.area, 0)

  await selectWall(page, top.id)
  const largo = page.getByLabel('Largo')
  const current = Number(await largo.inputValue())
  await largo.fill((current + 0.5).toFixed(2))
  await largo.press('Enter')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('guardado', { exact: true })).toBeVisible()

  const after = await getProject(page)
  expect(after.revision).toBe(before.revision + 1)
  const newTop = walls(after).find((w) => w.id === top.id)!
  expect(Math.hypot(newTop.end.x - newTop.start.x, newTop.end.y - newTop.start.y)).toBeCloseTo(current + 0.5, 1)
  // la esquina sigue unida: algún otro muro empieza o termina justo en el nuevo extremo
  expect(walls(after).some((w) => w.id !== top.id && (near(w.start, newTop.end) || near(w.end, newTop.end)))).toBe(true)
  // los ambientes se recalcularon desde los muros: el área total cambió
  const areaAfter = after.model.levels[0]!.rooms.reduce((s, r) => s + r.area, 0)
  expect(Math.abs(areaAfter - areaBefore)).toBeGreaterThan(0.5)
})

test('dos personas editando: la segunda recibe el aviso y puede sobrescribir', async ({ browser }) => {
  const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const b = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await openEditor(a)
  await openEditor(b)

  for (const [page, name] of [
    [a, 'Living A'],
    [b, 'Living B'],
  ] as const) {
    await page.getByRole('region', { name: 'Ambientes' }).getByRole('button').first().click()
    await page.getByLabel('Nombre').fill(name)
    await page.getByRole('button', { name: 'Renombrar' }).click()
  }
  await a.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(a.getByText('guardado', { exact: true })).toBeVisible()

  await b.getByRole('button', { name: 'Guardar cambios' }).click()
  const dialog = b.getByRole('dialog', { name: 'Otra versión se guardó mientras editabas' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Sobrescribir con la mía' }).click()
  await expect(dialog).toBeHidden()
  const p = await getProject(b)
  expect(p.model.levels[0]!.rooms.map((r) => r.label)).toContain('Living B')
  // cerrar ambos contextos: dos visores 3D abiertos consumen CPU y afectan las pruebas siguientes
  await a.context().close()
  await b.context().close()
})

test('historial: se ve la corrección y se restaura la detección original', async ({ page }) => {
  await openEditor(page)
  const before = await getProject(page)
  await page.getByRole('button', { name: 'Historial de versiones' }).click()
  const dialog = page.getByRole('dialog', { name: 'Historial de versiones' })
  await expect(dialog.getByText(/Corrección sobre la detección automática/)).toBeVisible()
  await expect(dialog.getByText(/v1 · Detección automática/)).toBeVisible()
  await dialog.getByRole('listitem').filter({ hasText: 'v1 ·' }).getByRole('button', { name: 'Restaurar' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await getProject(page)).revision).toBe(before.revision + 1)
  const revs = (await (await page.request.get(`/api/projects/${projectId}/revisions`)).json()) as { summary: string }[]
  expect(revs[0]!.summary).toBe('Restaurada la versión 1')
})

test('medir: distancia y área sin tocar el modelo', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('m')
  const box = (await page.getByTestId('editor2d').boundingBox())!
  const pts = [
    [0.3, 0.3],
    [0.6, 0.3],
    [0.6, 0.6],
  ] as const
  await page.mouse.click(box.x + box.width * pts[0][0], box.y + box.height * pts[0][1])
  await page.mouse.click(box.x + box.width * pts[1][0], box.y + box.height * pts[1][1])
  const status = page.getByTestId('editor2d').getByRole('status')
  await expect(status).toContainText('Distancia:')
  await page.mouse.click(box.x + box.width * pts[2][0], box.y + box.height * pts[2][1])
  await expect(status).toContainText('Área:')
  await expect(page.getByText('guardado', { exact: true })).toBeVisible() // medir no ensucia el modelo
  await page.keyboard.press('Escape')
})
