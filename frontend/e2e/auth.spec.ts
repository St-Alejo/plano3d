import { expect, test } from '@playwright/test'

// sin la sesión de la corrida: como alguien que llega por primera vez
test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} })

test('sin sesión, la app pide entrar y la cuenta demo abre la casa de 3 pisos', async ({ page }) => {
  const cfg = (await (await page.request.get('/api/auth/config')).json()) as { auth_required: boolean; demo_enabled: boolean }
  test.skip(!cfg.auth_required || !cfg.demo_enabled, 'el servidor corre sin cuentas o sin demo')

  await page.goto('/proyectos')
  await expect(page).toHaveURL(/\/entrar\?next=%2Fproyectos$/)
  await expect(page.getByRole('heading', { name: 'Entra a tus planos' })).toBeVisible()

  await page.getByRole('button', { name: /Entrar con la cuenta demo/ }).click()
  await expect(page).toHaveURL(/\/proyectos$/)
  await expect(page.getByRole('link', { name: 'Casa de 3 pisos' })).toBeVisible()

  // la sesión sobrevive a recargar (token de refresco)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Casa de 3 pisos' })).toBeVisible()

  // cerrar sesión vuelve a la entrada
  await page.getByRole('button', { name: 'Cuenta de Cuenta demo' }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await expect(page).toHaveURL(/\/entrar$/)
})

test('una contraseña equivocada muestra el error sin salir de la entrada', async ({ page }) => {
  const cfg = (await (await page.request.get('/api/auth/config')).json()) as { auth_required: boolean }
  test.skip(!cfg.auth_required, 'el servidor corre sin cuentas')
  await page.goto('/entrar')
  await page.getByLabel('Correo').fill('nadie@plano3d.test')
  await page.getByLabel('Contraseña').fill('no-es-esta-1')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('incorrectos')
})
