/** Tutorial "Crear desde cero" (guion en GUION.md): chat para los ambientes, ratón para el resto, ver en 3D. */
import { test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  clickEl, dim, dragFrom, drawCompass, drawRewind, drawSheet, focus, focusEl, hit, hold, installOverlay, pause, pulse,
  pxPerMeter, ruler, scene, screenOf, typeSlow,
} from './helpers'

const OUT = fileURLToPath(new URL('../../public/tutoriales/crear.webm', import.meta.url))
const MPP = 0.01
const STEPS = 8
let projectId = ''

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('crear un plano desde cero', async ({ page }) => {
  await installOverlay(page)
  await page.goto('/nuevo')
  const name = page.getByLabel('Nombre del plano')
  await name.scrollIntoViewIfNeeded()
  await pause(page, 400)

  // 0 · hoja en blanco: la analogía se dibuja tal cual sobre la tarjeta de "desde cero"
  await scene(page, { title: 'Hoja en blanco', sub: 'Sin foto: el plano lo *dibujas* tú', step: 0, steps: STEPS })
  // la hoja cubre la tarjeta "¿No tienes el plano?" (del título al botón)
  const head = (await page.getByText('¿No tienes el plano?').boundingBox())!
  const btn = (await page.getByRole('button', { name: 'Empezar desde cero' }).boundingBox())!
  await drawSheet(page, { x: head.x - 56, y: head.y - 18, width: 560, height: btn.y + btn.height + 18 - (head.y - 18) })
  await hit(page)
  await hold(page, 1600)

  // 1 · nombre y empezar
  await scene(page, { title: 'Ponle nombre', sub: 'Escribe «Mi casa» y *empieza*', step: 1, steps: STEPS })
  await focusEl(page, name, 10)
  await typeSlow(page, name, 'Mi casa', 70)
  await focusEl(page, page.getByRole('button', { name: 'Empezar desde cero' }))
  await pause(page, 500)
  await hit(page)
  await clickEl(page, page.getByRole('button', { name: 'Empezar desde cero' }))
  await page.waitForURL(/\/estudio$/)
  projectId = page.url().split('/p/')[1]!.split('/')[0]!
  await page.getByRole('radio', { name: 'Plano' }).click() // solo el plano mientras se dibuja
  await pause(page, 900)

  // 2 · la sala por chat, con sus medidas a escala
  const box = page.getByRole('textbox', { name: 'Mensaje para el plano' })
  await scene(page, { title: 'Escribe la sala', sub: '«sala de *5 × 4*, cocina de 3 × 4 al este»', step: 2, steps: STEPS })
  await focusEl(page, box, 10)
  await typeSlow(page, box, 'sala de 5x4, cocina de 3x4 al este de la sala')
  await box.press('Enter')
  await focus(page, null)
  await page.getByText('Dibujé Cocina').waitFor()
  await pause(page, 600)
  // se cierra el chat para ver el plano entero
  await clickEl(page, page.getByRole('button', { name: 'Cerrar chat' }))
  await page.getByRole('button', { name: 'Encuadrar' }).click()
  await pause(page, 500)
  const at = (x: number, y: number) => screenOf(page, MPP, { x, y })
  await ruler(page, await pxPerMeter(page, MPP), 1)
  await hit(page)
  await dim(page, await at(0, 0), await at(5, 0), '5 m', -22)
  await dim(page, await at(0, 4), await at(0, 0), '4 m', -22)
  await pause(page, 500)
  await drawCompass(page, await at(6.5, 2), 'E')
  await hold(page, 1400)

  // 3 · aberturas: cada una se marca cuando se nombra
  await scene(page, { title: 'Puertas y ventanas', sub: 'Puerta a la cocina, puerta al sur, *ventana* al norte', step: 3, steps: STEPS })
  await clickEl(page, page.getByRole('button', { name: 'Dibujar escribiendo' }))
  await focusEl(page, box, 10)
  await typeSlow(page, box, 'puerta entre la sala y la cocina, puerta al sur de la sala, ventana al norte de la sala')
  await box.press('Enter')
  await focus(page, null)
  await page.getByText('Agregué una ventana').waitFor()
  await pause(page, 600)
  await clickEl(page, page.getByRole('button', { name: 'Cerrar chat' }))
  await pause(page, 400)
  await pulse(page, await at(5, 2))
  await pause(page, 350)
  await pulse(page, await at(2.5, 4))
  await pause(page, 350)
  await hit(page)
  await pulse(page, await at(2.5, 0))
  await hold(page, 1300)

  // 4 · deshacer: flecha de rebobinado (la misma del tutorial de edición)
  await scene(page, { title: 'Ctrl+Z deshace', sub: 'Todo lo del chat *se deshace* y se rehace', step: 4, steps: STEPS })
  await drawRewind(page, await at(2.5, 2))
  await hit(page)
  await page.keyboard.press('Control+z')
  await pause(page, 1100)
  await drawRewind(page, await at(2.5, 2), true)
  await page.keyboard.press('Control+Shift+z')
  await hold(page, 1200)

  // 5 · con el ratón: la cota crece con el rectángulo
  await scene(page, { title: 'O con el ratón', sub: 'Herramienta H: arrastra un *rectángulo*', step: 5, steps: STEPS })
  await clickEl(page, page.getByRole('button', { name: 'Dibujar ambiente' }))
  // se aleja un poco con la rueda para tener espacio debajo
  const canvas = page.locator('[data-testid=editor2d]')
  const cb = (await canvas.boundingBox())!
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.3)
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(120)
  }
  await pause(page, 500)
  await ruler(page, await pxPerMeter(page, MPP), 1)
  await dragFrom(page, await at(0, 4), await at(3, 6.5), () => hit(page))
  await dim(page, await at(0, 6.5), await at(3, 6.5), '3 m')
  await dim(page, await at(3, 6.5), await at(3, 4), '2,5 m')
  const roomName = page.getByLabel('Nombre del ambiente:')
  await roomName.pressSequentially('Baño', { delay: 70 })
  await roomName.press('Enter')
  await hold(page, 1400)

  // 6 · 3D: los muros se levantan del mismo plano
  await scene(page, { title: 'Míralo en 3D', sub: 'Clic en 3D: los muros *se levantan*', step: 6, steps: STEPS })
  await ruler(page, null)
  await focusEl(page, page.getByRole('radio', { name: '3D' }), 6)
  await pause(page, 400)
  await hit(page)
  await clickEl(page, page.getByRole('radio', { name: '3D' }))
  await focus(page, null)
  await hold(page, 3000)

  // 7 · guardar
  await scene(page, { title: 'Guarda', sub: '*Ctrl+S* y sigue cuando quieras', step: 7, steps: STEPS })
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
