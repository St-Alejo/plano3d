/** Tutorial "Editar" (guion en GUION.md): mover una puerta a otro muro, borrar y agregar ventanas, afinar y deshacer. */
import { test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  clickAt, clickEl, dim, dragFrom, drawEraser, drawRewind, focus, focusEl, glide, hit, hold, installOverlay, path, pause, pulse,
  pxPerMeter, ruler, scene, screenOf,
} from './helpers'

const OUT = fileURLToPath(new URL('../../public/tutoriales/editar.webm', import.meta.url))
const MPP = 0.01
const STEPS = 8
let projectId = ''

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('editar un plano en el estudio', async ({ page, browser, request }) => {
  // preparación (no se graba): sala 5 × 4 y alcoba 3 × 4 dibujadas con el chat
  projectId = ((await (await request.post('/api/projects/blank', { data: { name: 'Apartamento' } })).json()) as { id: string }).id
  const setup = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await setup.goto(`/p/${projectId}/estudio`)
  const box = setup.getByRole('textbox', { name: 'Mensaje para el plano' })
  await box.fill(
    'sala de 5x4 con ventana al norte y puerta al sur, alcoba de 3x4 al este de la sala con ventana al este, puerta entre la sala y la alcoba',
  )
  await box.press('Enter')
  await setup.getByText('Agregué una puerta entre Sala y Alcoba').waitFor()
  await box.press('Control+s')
  await setup.getByText('guardado', { exact: true }).waitFor()
  await setup.close()

  await installOverlay(page)
  await page.goto(`/p/${projectId}/estudio`)
  await page.getByTestId('studio').waitFor()
  const closeChat = page.getByRole('button', { name: 'Cerrar chat' })
  if (await closeChat.isVisible()) await closeChat.click()
  await page.getByRole('radio', { name: 'Plano' }).click()
  await page.getByRole('button', { name: 'Encuadrar' }).click()
  await pause(page, 700)
  const at = (x: number, y: number) => screenOf(page, MPP, { x, y })
  await ruler(page, await pxPerMeter(page, MPP), 1)

  // 0 · todo se mueve: cada pieza editable late por turno
  await scene(page, { title: 'Todo se mueve', sub: 'Muros, puertas y ventanas se *mueven*', step: 0, steps: STEPS })
  await pulse(page, await at(2.5, 4))
  await pause(page, 350)
  await pulse(page, await at(2.5, 0))
  await pause(page, 350)
  await hit(page)
  await pulse(page, await at(5, 2))
  await pause(page, 350)
  await pulse(page, await at(8, 2))
  await hold(page, 1300)

  // 1 · el lienzo: la regla de 1 m acompaña todo el video
  await scene(page, { title: 'A escala', sub: 'Sala de *5 m* por 4 m, alcoba de 3 m', step: 1, steps: STEPS })
  await hit(page)
  await dim(page, await at(0, 0), await at(5, 0), '5 m', -22)
  await dim(page, await at(0, 4), await at(0, 0), '4 m', -22)
  await dim(page, await at(5, 4), await at(8, 4), '3 m', 22)
  await hold(page, 1800)

  // 2 · arrastrar la puerta del muro sur al oeste
  await scene(page, { title: 'Arrastra la puerta', sub: 'Llévala a *otro muro*; las cotas te guían', step: 2, steps: STEPS })
  await path(page, await at(2.5, 4.35), await at(-0.35, 1.2))
  await pause(page, 900)
  await dragFrom(page, await at(2.5, 4), await at(0, 1.2), () => hit(page))
  await pause(page, 500)
  await pulse(page, await at(0, 1.2))
  await hold(page, 1200)

  // 3 · borrar la ventana norte: un borrador pasa por encima
  await scene(page, { title: 'Bórrala', sub: 'Selecciónala y pulsa *Supr*', step: 3, steps: STEPS })
  await clickAt(page, await at(2.5, 0))
  await pause(page, 700)
  const win = await at(2.5, 0)
  await drawEraser(page, win, (await pxPerMeter(page, MPP)) * 1.6)
  await pause(page, 500)
  await hit(page)
  await page.keyboard.press('Delete')
  await hold(page, 1300)

  // 4 · agregar una ventana con la herramienta
  await scene(page, { title: 'Agrega ventana', sub: 'Herramienta Ventana (N) y *clic* en un muro', step: 4, steps: STEPS })
  const tool = page.getByRole('button', { name: 'Agregar ventana' })
  await focusEl(page, tool, 6)
  await clickEl(page, tool)
  await focus(page, null)
  await glide(page, await at(6.5, 3.6))
  await hit(page)
  await clickAt(page, await at(6.5, 4))
  await pause(page, 300)
  await pulse(page, await at(6.5, 4))
  await page.keyboard.press('v')
  await hold(page, 1200)

  // 5 · afinar en el panel: centrada, la puerta queda a 2 m de cada esquina
  await scene(page, { title: 'Afina el panel', sub: '*Centrar* la puerta o invertir su giro', step: 5, steps: STEPS })
  await clickAt(page, await at(0, 1.2))
  await pause(page, 600)
  const center = page.getByRole('button', { name: 'Centrar' })
  await focusEl(page, center, 6)
  await pause(page, 400)
  await hit(page)
  await clickEl(page, center)
  await focus(page, null)
  await pause(page, 400)
  await dim(page, await at(0, 0), await at(0, 2), '2 m', -26)
  await dim(page, await at(0, 2), await at(0, 4), '2 m', -26)
  await pause(page, 900)
  await clickEl(page, page.getByRole('button', { name: /Invertir giro/ }))
  await hold(page, 1300)

  // 6 · deshacer y rehacer: la misma flecha del tutorial de crear
  await scene(page, { title: 'Deshacer y rehacer', sub: 'Ctrl+Z *deshace*, Ctrl+Shift+Z rehace', step: 6, steps: STEPS })
  await drawRewind(page, await at(2.5, 2))
  await hit(page)
  await page.keyboard.press('Control+z')
  await pause(page, 1100)
  await drawRewind(page, await at(2.5, 2), true)
  await page.keyboard.press('Control+Shift+z')
  await hold(page, 1200)

  // 7 · revisar en 3D y guardar
  await scene(page, { title: 'Revisa en 3D', sub: 'Mira el cambio en 3D y *guarda*', step: 7, steps: STEPS })
  await ruler(page, null)
  await clickEl(page, page.getByRole('radio', { name: '3D' }))
  await pause(page, 2200)
  await hit(page)
  await page.keyboard.press('Control+s')
  const saved = page.getByText('guardado', { exact: true })
  await saved.waitFor()
  await focusEl(page, saved, 8)
  await pause(page, 1100)
  await focus(page, null)
  await hold(page, 1600)

  await page.close()
  await page.video()!.saveAs(OUT)
})
