/**
 * Tutorial "Recorrer en 3D" (guion en GUION.md) con la casa real «Opción 3»: tres pisos de 2,60 m,
 * escalera en U de 15 peldaños, portón y muebles. Se arma igual que `backend/scripts/demo_opc3.py`.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  clickEl, drawKeys, drawLevels, drawPerson, drawRay, drawStairProfile, focus, focusEl, hit, hold, installOverlay, pause,
  pulse, scene, setGlideSteps,
} from './helpers'

const OUT = fileURLToPath(new URL('../../public/tutoriales/recorrer.webm', import.meta.url))
const REAL = new URL('../../../backend/tests/real/', import.meta.url)
const STEPS = 8
let projectId = ''

type Project = { id: string; revision: number; status: string; model: { levels: { id: string; elevation: number }[] } }

const ifMatch = (p: Project) => ({ 'If-Match': `"${p.revision}"` })

async function ok(r: Awaited<ReturnType<APIRequestContext['get']>>): Promise<Project> {
  expect(r.ok(), await r.text()).toBe(true)
  return (await r.json()) as Project
}

/** La casa de 3 pisos: PDF del piso 1, PDF del piso 2, piso 3 duplicado, muebles y fachada. */
async function buildHouse(request: APIRequestContext): Promise<Project> {
  const pdf = (name: string) => ({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: readFileSync(new URL(`${name}/plano.pdf`, REAL)) })
  let p = await ok(await request.post('/api/projects', { multipart: { name: 'Casa de tres pisos', file: pdf('opc3p1') } }))
  projectId = p.id
  await expect.poll(async () => (p = await ok(await request.get(`/api/projects/${p.id}`))).status, { timeout: 180_000 }).toBe('ready')
  p = await ok(await request.post(`/api/projects/${p.id}/levels`, { multipart: { name: 'Piso 2', file: pdf('opc3p2') }, headers: ifMatch(p) }))
  const second = [...p.model.levels].sort((a, b) => a.elevation - b.elevation).at(-1)!
  p = await ok(await request.post(`/api/projects/${p.id}/levels/${second.id}/duplicate`, { data: { name: 'Piso 3' }, headers: ifMatch(p) }))
  p = await ok(await request.post(`/api/projects/${p.id}/furnish`, { data: {}, headers: ifMatch(p) }))
  p = await ok(await request.put(`/api/projects/${p.id}/facade`, { data: { style: 'moderna_contemporanea', custom: null }, headers: ifMatch(p) }))
  return p
}

let house: Project

// la casa se arma antes de abrir la página: el video empieza a grabar al crearla
test.beforeAll(async ({ playwright, browser }) => {
  test.setTimeout(300_000)
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
  const request = await playwright.request.newContext({ baseURL: base })
  house = await buildHouse(request)
  await request.dispose()
  // calentar el visor y el modo recorrer (módulos y sombreadores) para que no carguen en el video
  const warm = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await warm.goto(`${base}/p/${projectId}/3d`)
  await warm.getByRole('radio', { name: /Recorrer/ }).click()
  await warm.getByTestId('walk-hud').waitFor({ timeout: 120_000 })
  await warm.waitForTimeout(2000)
  await warm.close()
})

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`/api/projects/${projectId}`)
})

test('recorrer en 3D', async ({ page }) => {
  const elevations = house.model.levels.map((l) => l.elevation).sort((a, b) => a - b)
  const hud = page.getByTestId('walk-hud')

  setGlideSteps(5)
  // la ayuda "Cómo recorrer" se da por vista: el tutorial explica lo mismo, escena por escena
  await page.addInitScript(() => localStorage.setItem('plano3d-ayuda-recorrido', '1'))
  await installOverlay(page)
  await page.goto(`/p/${projectId}/3d`)
  await page.getByRole('radio', { name: /Recorrer/ }).waitFor()
  await pause(page, 2500)

  // 0 · "como si estuvieras adentro": una persona de 1,70 m llega a la entrada de la maqueta
  await scene(page, { title: 'Entra a casa', sub: 'Camina como si *estuvieras adentro*', step: 0, steps: STEPS })
  await hit(page)
  await drawPerson(page, { x: 660, y: 598 }, 64)
  await hold(page, 2000)

  // 1 · modo recorrer: la cámara baja a la altura de los ojos
  await scene(page, { title: 'Elige Recorrer', sub: 'Pulsa *Recorrer* y entra', step: 1, steps: STEPS })
  const walk = page.getByRole('radio', { name: /Recorrer/ })
  await focusEl(page, walk, 6)
  await pause(page, 500)
  await hit(page)
  await clickEl(page, walk)
  await focus(page, null)
  await hud.waitFor()
  await hold(page, 1300)

  // 2 · la escalera: 15 peldaños de 17 cm = 2,60 m; el punto sube mientras se cambia de piso
  await scene(page, { title: 'Sube la escalera', sub: 'Por la escalera o con *Q*', step: 2, steps: STEPS })
  await drawStairProfile(page, { x: 760, y: 610 }, 15, 0.1733, 75, 1.6)
  await pause(page, 1200)
  await hit(page)
  await page.keyboard.press('KeyQ')
  await expect(hud).toHaveAttribute('data-level-index', '1')
  await hold(page, 1600)

  // 3 · tres pisos apilados con su elevación; el actual en ladrillo
  await scene(page, { title: 'Tres pisos', sub: 'Q sube, *Z baja* un piso', step: 3, steps: STEPS })
  await drawLevels(page, { x: 1040, y: 600 }, elevations, 1)
  await pause(page, 900)
  await page.keyboard.press('KeyQ')
  await expect(hud).toHaveAttribute('data-level-index', '2')
  await drawLevels(page, { x: 1040, y: 600 }, elevations, 2)
  await pause(page, 1300)
  await hit(page)
  await page.keyboard.press('KeyZ')
  await expect(hud).toHaveAttribute('data-level-index', '1')
  await drawLevels(page, { x: 1040, y: 600 }, elevations, 1)
  await pause(page, 1000)
  await page.keyboard.press('KeyZ')
  await expect(hud).toHaveAttribute('data-level-index', '0')
  await drawLevels(page, { x: 1040, y: 600 }, elevations, 0)
  await hold(page, 1300)

  // 4 · caminar: las teclas dibujadas se hunden mientras se avanza hacia la puerta
  await scene(page, { title: 'Camina', sub: 'W A S D o el *joystick* en el celular', step: 4, steps: STEPS })
  await drawKeys(page, { x: 1080, y: 470 })
  await pause(page, 700)
  await drawKeys(page, { x: 1080, y: 470 }, ['W'])
  await hit(page)
  await page.keyboard.down('KeyW')
  await expect(hud).toHaveAttribute('data-focus', /^door:/, { timeout: 10_000 })
  await page.keyboard.up('KeyW')
  await drawKeys(page, { x: 1080, y: 470 })
  await hold(page, 1000)

  // 5 · abrir la puerta: el rayo de mira alcanza 2,4 m
  await scene(page, { title: 'Abre la puerta', sub: 'Apunta (alcance 2,4 m) y pulsa *E*', step: 5, steps: STEPS })
  await drawRay(page, { x: 640, y: 690 }, { x: 640, y: 372 }, '2,4 m')
  await pause(page, 1100)
  await hit(page)
  await page.keyboard.press('KeyE')
  await hold(page, 2000)

  // 6 · minimapa: dónde estás y a dónde ir
  await scene(page, { title: 'Mira el minimapa', sub: '*Tócalo* para ir a otro punto', step: 6, steps: STEPS })
  const head = (await page.getByRole('button', { name: /^Minimapa/ }).boundingBox())!
  const last = (await page.getByRole('button', { name: /^Ir a / }).last().boundingBox())!
  await focus(page, { x: head.x, y: head.y, width: Math.max(head.width, last.x + last.width - head.x), height: last.y + last.height - head.y }, 10)
  await pause(page, 600)
  await hit(page)
  await pulse(page, { x: head.x + 60, y: head.y + 100 }, 18)
  await hold(page, 1800)

  // 7 · puertas automáticas: se cierra la puerta, se activa y se abre sola al caminar hacia ella
  await page.keyboard.press('KeyE')
  await scene(page, { title: 'Puertas automáticas', sub: 'Actívalas y se abren *solas*', step: 7, steps: STEPS })
  await pause(page, 600)
  const auto = page.getByRole('button', { name: 'Puertas automáticas' })
  await focusEl(page, auto, 6)
  await pause(page, 400)
  await clickEl(page, auto)
  await focus(page, null)
  await pause(page, 300)
  await page.keyboard.down('KeyW')
  await hit(page)
  await pause(page, 2200)
  await page.keyboard.up('KeyW')
  await pause(page, 600)
  // imagen final: de vuelta a la maqueta entera, la misma del comienzo
  await page.getByRole('radio', { name: /Orbitar/ }).click()
  await hold(page, 2400)

  await page.close()
  await page.video()!.saveAs(OUT)
})
