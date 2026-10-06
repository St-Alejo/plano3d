/** Landing: la secuencia avanza con el scroll, lleva a la captura y respeta el movimiento reducido. */
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))

test('la secuencia del hero avanza figura por figura con el scroll', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  const stage = page.getByRole('region', { name: /Del plano al modelo 3D/ })
  await expect(stage).toBeVisible()
  const steps = page.getByRole('list', { name: 'Figuras de la secuencia' }).getByRole('listitem')
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')

  const box = await stage.evaluate((el: HTMLElement) => ({ top: el.offsetTop, h: el.offsetHeight }))
  const vh = page.viewportSize()!.height
  await page.evaluate((y) => window.scrollTo(0, y), box.top + 0.95 * (box.h - vh))
  await expect(steps.nth(4)).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('Recorrido', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('el archivo elegido en la landing abre la captura ya cargado', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(PHOTO)
  await expect(page).toHaveURL(/\/nuevo$/)
  await expect(page.getByLabel('Nombre del proyecto')).toHaveValue('plano foto')
  await expect(page.getByRole('button', { name: 'Convertir a 3D' })).toBeVisible()
})

test('los enlaces principales llevan a la app', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Abrir la app/ }).click()
  await expect(page.getByRole('heading', { name: 'Tus planos' })).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: /Convertir un plano/ }).first().click()
  await expect(page.getByRole('button', { name: 'Tomar foto' })).toBeVisible()
})

test.describe('movimiento reducido', () => {
  test.use({ reducedMotion: 'reduce' })
  test('muestra la lámina estática con las cinco figuras', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('region', { name: /Del plano al modelo 3D/ })).toHaveCount(0)
    for (const n of ['01', '02', '03', '04', '05']) await expect(page.getByText(`Fig. ${n}`, { exact: true })).toBeVisible()
  })
})
