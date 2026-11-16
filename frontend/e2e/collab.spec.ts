/**
 * Edición en vivo (ADR-021): dos pestañas del mismo proyecto. Lo que se mueve en una
 * aparece en la otra en menos de 200 ms, sin guardar a mano, y queda guardado.
 */
import { expect, test, type Page } from '@playwright/test'

test.skip(({ isMobile }) => isMobile, 'flujo de escritorio')

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

test.beforeAll(async ({ request }) => {
  const cfg = (await (await request.get('/api/auth/config')).json()) as { auth_required: boolean }
  test.skip(!cfg.auth_required, 'la edición en vivo necesita cuentas')
  const created = await request.post('/api/projects/blank', { data: { name: 'En vivo E2E' } })
  expect(created.ok()).toBe(true)
  projectId = ((await created.json()) as { id: string }).id
  const project = (await (await request.get(`/api/projects/${projectId}`)).json()) as { model: { levels: object[] } }
  const put = await request.put(`/api/projects/${projectId}/model`, {
    headers: { 'If-Match': '*' },
    data: {
      ...project.model,
      levels: [
        {
          ...project.model.levels[0],
          walls: [
            wall('w_top', 1, 1, 9, 1, [{ id: 'o_door', kind: 'door', offset: 2, width: 0.9, height: 2.1, sill: 0, confidence: 1 }]),
            wall('w_right', 9, 1, 9, 7),
            wall('w_bottom', 9, 7, 1, 7),
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
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

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

/** Abre el estudio y espera a estar en la sala; devuelve los mensajes que le llegan por el socket. */
async function openLive(page: Page) {
  const frames: { at: number; dir: 'in' | 'out'; msg: { type: string; op_id?: string } }[] = []
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/ws/collab/')) return
    const keep = (dir: 'in' | 'out') => (f: { payload: string | Buffer }) => {
      try {
        frames.push({ at: Date.now(), dir, msg: JSON.parse(String(f.payload)) as { type: string } })
      } catch {
        /* nada */
      }
    }
    ws.on('framereceived', keep('in'))
    ws.on('framesent', keep('out'))
  })
  await page.goto(`/p/${projectId}/estudio`)
  await expect(page.getByTestId('studio')).toBeVisible()
  await page.keyboard.press('1') // solo el plano
  await expect(page.locator('[data-testid=editor2d] canvas').first()).toBeVisible()
  await expect(page.getByTestId('presence-bar')).toContainText('en vivo')
  return frames
}

test('lo que se mueve en una pestaña aparece en la otra al instante', async ({ context }) => {
  const a = await context.newPage()
  const b = await context.newPage()
  const framesA = await openLive(a)
  const framesB = await openLive(b)
  // cada una ve a la otra en la barra de presencia
  await expect(a.getByRole('list', { name: /1 persona/ })).toBeVisible()
  await expect(b.getByRole('list', { name: /1 persona/ })).toBeVisible()

  const mpp = ((await (await a.request.get(`/api/projects/${projectId}`)).json()) as { model: { scale: { meters_per_pixel: number } } }).model.scale.meters_per_pixel

  // en A: la puerta del muro de arriba (centro en x=1+2+0,45) se arrastra al muro derecho
  // (el de abajo lo tapa el panel de dibujar escribiendo de los planos en blanco)
  await a.bringToFront()
  const from = await screenOf(a, mpp, { x: 3.45, y: 1 })
  const to = await screenOf(a, mpp, { x: 9, y: 3 })
  await a.mouse.move(from.x, from.y)
  await a.mouse.down()
  for (let i = 1; i <= 12; i++) await a.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
  // mientras arrastra, B recibe el fantasma
  await expect.poll(() => framesB.some((f) => f.dir === 'in' && f.msg.type === 'preview')).toBe(true)
  await a.mouse.up()
  await expect(a.getByRole('combobox', { name: 'Muro de la abertura' })).toHaveValue('w_right')

  // B recibe el cambio confirmado en menos de 200 ms desde que A lo envía (red + servidor)
  const sent = () => framesA.find((f) => f.dir === 'out' && f.msg.type === 'ops')
  await expect.poll(() => sent()?.at ?? 0).toBeGreaterThan(0)
  const applied = () => framesB.find((f) => f.dir === 'in' && f.msg.type === 'applied' && f.msg.op_id === sent()!.msg.op_id)
  await expect.poll(() => applied()?.at ?? 0).toBeGreaterThan(0)
  const lag = applied()!.at - sent()!.at
  test.info().annotations.push({ type: 'latencia', description: `${lag} ms` })
  expect(lag).toBeLessThan(200)
  await expect(b.getByText(/Cambios de .+ en la web/)).toBeVisible()

  // y B lo muestra: la puerta ya está en el muro derecho
  await b.bringToFront()
  const door = await screenOf(b, mpp, { x: 9, y: 3 })
  await b.mouse.click(door.x, door.y)
  await expect(b.getByRole('heading', { name: 'Puerta' })).toBeVisible()
  await expect(b.getByRole('combobox', { name: 'Muro de la abertura' })).toHaveValue('w_right')

  // sin guardar a mano: el servidor ya lo tiene (leer guarda lo pendiente de la sala)
  await expect(a.getByRole('button', { name: 'Se guarda solo (en vivo)' })).toBeDisabled()
  const saved = (await (await a.request.get(`/api/projects/${projectId}`)).json()) as {
    model: { levels: { walls: { id: string; openings: { id: string }[] }[] }[] }
  }
  const right = saved.model.levels[0]!.walls.find((w) => w.id === 'w_right')!
  expect(right.openings.map((o) => o.id)).toEqual(['o_door'])
})
