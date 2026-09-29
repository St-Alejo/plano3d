/** Vista móvil: la captura y el espacio de trabajo por pestañas funcionan en una pantalla chica. */
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))

test('en el celular: tomar foto → pestañas 2D / 3D / detalles', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Nuevo' })).toBeVisible()
  // sin scroll horizontal
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await page.getByRole('link', { name: 'Nuevo' }).click()
  await expect(page.getByRole('button', { name: 'Tomar foto' })).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(PHOTO)
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()

  await expect(page.getByRole('tab', { name: 'Plano 2D' })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('tab', { name: 'Vista 3D' }).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Detalles' }).click()
  await expect(page.getByText('Resumen')).toBeVisible()

  await page.request.delete(`/api/projects/${page.url().split('/p/')[1]}`)
})
