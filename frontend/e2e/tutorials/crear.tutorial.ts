/** Tutorial "Crear desde cero": chat para los ambientes, ratón para el resto, ver en 3D. */
import { test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { caption, clickEl, dragFrom, installOverlay, pause, screenOf, typeSlow } from './helpers'

const OUT = fileURLToPath(new URL('../../public/tutoriales/crear.webm', import.meta.url))
let projectId = ''

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('crear un plano desde cero', async ({ page }) => {
  await installOverlay(page)
  await page.goto('/nuevo')
  await caption(page, 'Crear un plano desde cero', 'Sin foto: lo dibujas tú, escribiendo o con el ratón')
  await pause(page, 1800)

  const name = page.getByLabel('Nombre del plano')
  await name.scrollIntoViewIfNeeded()
  await caption(page, '1 · Ponle un nombre y pulsa «Empezar desde cero»')
  await typeSlow(page, name, 'Mi casa')
  await clickEl(page, page.getByRole('button', { name: 'Empezar desde cero' }))
  await page.waitForURL(/\/estudio$/)
  projectId = page.url().split('/p/')[1]!.split('/')[0]!
  await page.keyboard.press('1') // solo el plano mientras se dibuja
  await pause(page, 900)

  const box = page.getByRole('textbox', { name: 'Mensaje para el plano' })
  await caption(page, '2 · Escribe lo que quieres en el chat', 'Medidas en metros: ancho × fondo; lados: norte, sur, este, oeste')
  await typeSlow(page, box, 'sala de 5x4, cocina de 3x4 al este de la sala')
  await box.press('Enter')
  await pause(page, 1600)
  await caption(page, '3 · Agrega puertas y ventanas por su ambiente y su lado')
  await typeSlow(page, box, 'puerta entre la sala y la cocina, puerta al sur de la sala, ventana al norte de la sala')
  await box.press('Enter')
  await pause(page, 2000)
  await caption(page, 'Todo lo que hace el chat se deshace con Ctrl+Z')
  await pause(page, 1600)

  await clickEl(page, page.getByRole('button', { name: 'Cerrar chat' }))
  await caption(page, '4 · O dibuja con el ratón: herramienta Ambiente (H)', 'Arrastra un rectángulo; los muros compartidos no se duplican')
  await clickEl(page, page.getByRole('button', { name: 'Dibujar ambiente' }))
  // se aleja un poco con la rueda para tener espacio debajo
  const canvas = page.locator('[data-testid=editor2d]')
  const cb = (await canvas.boundingBox())!
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.3)
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(120)
  }
  await pause(page, 500)
  const mpp = 0.01
  await dragFrom(page, await screenOf(page, mpp, { x: 0, y: 4 }), await screenOf(page, mpp, { x: 3, y: 6.5 }))
  const roomName = page.getByLabel('Nombre del ambiente:')
  await roomName.pressSequentially('Baño', { delay: 60 })
  await roomName.press('Enter')
  await pause(page, 1400)

  await caption(page, '5 · Míralo en 3D al instante (tecla 2)')
  await page.keyboard.press('2')
  await pause(page, 2600)
  await caption(page, '6 · Guarda con Ctrl+S', 'Puedes volver a editar todo cuando quieras')
  await page.keyboard.press('Control+s')
  await pause(page, 2200)

  await page.close()
  await page.video()!.saveAs(OUT)
})
