/** Tutorial "Editar": mover una puerta a otro muro, borrar y agregar ventanas, afinar y deshacer. */
import { test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { caption, clickAt, clickEl, dragFrom, installOverlay, pause, screenOf } from './helpers'

const OUT = fileURLToPath(new URL('../../public/tutoriales/editar.webm', import.meta.url))
const MPP = 0.01
let projectId = ''

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('editar un plano en el estudio', async ({ page, browser, request }) => {
  // preparación (no se graba): un plano de dos ambientes dibujado con el chat
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
  await page.goto(`/p/${projectId}`)
  await caption(page, 'Editar un plano', 'Todo se puede mover, borrar o agregar')
  await pause(page, 1600)
  await caption(page, '1 · Abre el Estudio: el editor a pantalla completa')
  await clickEl(page, page.getByRole('link', { name: 'Abrir el estudio a pantalla completa' }))
  await page.getByTestId('studio').waitFor()
  const closeChat = page.getByRole('button', { name: 'Cerrar chat' })
  if (await closeChat.isVisible()) await closeChat.click()
  await page.keyboard.press('1')
  await pause(page, 1000)

  const at = (x: number, y: number) => screenOf(page, MPP, { x, y })
  await caption(page, '2 · Arrastra una puerta a otro muro', 'Las cotas en vivo muestran dónde queda; en rojo si no cabe')
  await dragFrom(page, await at(2.5, 4), await at(0, 2))
  await pause(page, 1400)

  await caption(page, '3 · Selecciona la ventana y bórrala con Supr')
  await clickAt(page, await at(2.5, 0))
  await pause(page, 600)
  await page.keyboard.press('Delete')
  await pause(page, 1200)

  await caption(page, '4 · Agrega una ventana: herramienta Ventana (N) y clic en un muro')
  await clickEl(page, page.getByRole('button', { name: 'Agregar ventana' }))
  await clickAt(page, await at(6.5, 4))
  await pause(page, 1200)
  await page.keyboard.press('v')

  await caption(page, '5 · Afina en el panel: distancia exacta, otro muro, centrar o invertir el giro')
  await clickAt(page, await at(0, 2))
  await pause(page, 700)
  await clickEl(page, page.getByRole('button', { name: 'Centrar' }))
  await pause(page, 700)
  await clickEl(page, page.getByRole('button', { name: /Invertir giro/ }))
  await pause(page, 1200)

  await caption(page, '6 · Ctrl+Z deshace y Ctrl+Shift+Z rehace', 'Las flechas mueven lo seleccionado; R gira puertas y muebles')
  await page.keyboard.press('Control+z')
  await pause(page, 900)
  await page.keyboard.press('Control+Shift+z')
  await pause(page, 1200)

  await caption(page, '7 · Revisa en 3D (tecla 2) y guarda con Ctrl+S')
  await page.keyboard.press('2')
  await pause(page, 2400)
  await page.keyboard.press('Control+s')
  await pause(page, 1800)

  await page.close()
  await page.video()!.saveAs(OUT)
})
