/** Tutorial "Recorrer en 3D": caminar, abrir una puerta, subir de piso y el minimapa. */
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { caption, clickEl, installOverlay, pause } from './helpers'

const OUT = fileURLToPath(new URL('../../public/tutoriales/recorrer.webm', import.meta.url))
let projectId = ''

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, openings: object[] = []) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.15, height: 2.6, openings, confidence: 1,
})
const room = (id: string, label: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, label, confidence: 1, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('recorrer en 3D', async ({ page, request }) => {
  // casa de ejemplo: sala larga, puerta hacia un estudio con escalera a la planta alta
  const p = (await (await request.post('/api/projects/blank', { data: { name: 'Casa de ejemplo' } })).json()) as { id: string; revision: number; model: object }
  projectId = p.id
  const model = {
    ...p.model,
    levels: [
      {
        id: 'pb', name: 'Planta baja', elevation: 0,
        walls: [
          wall('a', 0, 0, 12, 0, [{ id: 'v1', kind: 'window', offset: 2, width: 1.5, height: 1.2, sill: 0.9, confidence: 1 }]),
          wall('b', 12, 0, 12, 3), wall('c', 12, 3, 0, 3), wall('d', 0, 3, 0, 0),
          wall('m', 7.5, 0, 7.5, 3, [{ id: 'p1', kind: 'door', offset: 1.05, width: 0.9, height: 2.1, sill: 0, confidence: 1 }]),
        ],
        rooms: [room('r1', 'Sala', 0.08, 0.08, 7.42, 2.92), room('r2', 'Estudio', 7.58, 0.08, 11.92, 2.92)],
        stairs: [{ id: 'st', start: { x: 11.5, y: 2.3 }, end: { x: 8.5, y: 2.3 }, width: 0.9, steps: 15, riser: 0.18, base: 0, confidence: 1 }],
      },
      { id: 'pa', name: 'Planta alta', elevation: 2.7, walls: [wall('a2', 0, 0, 12, 0), wall('b2', 12, 0, 12, 3), wall('c2', 12, 3, 0, 3), wall('d2', 0, 3, 0, 0)], rooms: [] },
    ],
  }
  expect((await request.put(`/api/projects/${p.id}/model`, { data: model, headers: { 'If-Match': `"${p.revision}"` } })).ok()).toBe(true)

  await installOverlay(page)
  await page.goto(`/p/${projectId}/3d`)
  await caption(page, 'Recorrer en 3D', 'Camina por el plano como si estuvieras adentro')
  await pause(page, 1800)
  await caption(page, '1 · Elige «Recorrer»')
  await clickEl(page, page.getByRole('radio', { name: /Recorrer/ }))
  await pause(page, 1600)
  await clickEl(page, page.getByRole('button', { name: 'Entendido' }))
  await caption(page, '2 · Camina con W A S D (en el celular, con el joystick)', 'Shift para correr; los muros y las puertas cerradas frenan')
  await page.keyboard.down('KeyW')
  await expect(page.getByTestId('walk-hud')).toHaveAttribute('data-focus', 'door:p1', { timeout: 10000 })
  await pause(page, 900)
  await page.keyboard.up('KeyW')
  await caption(page, '3 · Apunta a la puerta y pulsa E (o toca el botón)')
  await pause(page, 1500)
  await page.keyboard.press('KeyE')
  await pause(page, 1200)
  await page.keyboard.down('KeyW')
  await pause(page, 2200)
  await page.keyboard.up('KeyW')
  await caption(page, '4 · Las escaleras se suben caminando, o con Q / Z', 'En el celular: botones de piso arriba a la derecha')
  await pause(page, 1200)
  await page.keyboard.press('KeyQ')
  await pause(page, 2200)
  await caption(page, '5 · El minimapa muestra dónde estás; tócalo para ir a otro punto')
  await pause(page, 2200)
  await page.keyboard.press('KeyZ')
  await caption(page, 'Activa «Puertas automáticas» para que se abran solas', 'Así en el celular solo necesitas el joystick')
  await clickEl(page, page.getByRole('button', { name: 'Puertas automáticas' }))
  await pause(page, 2200)

  await page.close()
  await page.video()!.saveAs(OUT)
})
