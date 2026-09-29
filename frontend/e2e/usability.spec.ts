/**
 * Pruebas de usabilidad automatizadas (regresión de docs/usabilidad.md):
 * accesibilidad WCAG 2.1 AA con axe en ambos temas, objetivos táctiles, pantallas chicas,
 * teclado y protección de cambios sin guardar.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const PHOTO = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))
let projectId = ''

test.beforeAll(async ({ request }, info) => {
  // un proyecto por cada proyecto de Playwright (escritorio y celular corren en paralelo)
  const name = `Usabilidad ${info.project.name}`
  // limpieza de corridas anteriores interrumpidas
  const old = (await (await request.get('/api/projects')).json()) as { id: string; name: string }[]
  for (const p of old.filter((x) => x.name === name)) await request.delete(`/api/projects/${p.id}`)
  const res = await request.post('/api/projects', {
    multipart: { file: { name: 'plano.jpg', mimeType: 'image/jpeg', buffer: (await import('node:fs')).readFileSync(PHOTO) }, name },
  })
  projectId = ((await res.json()) as { id: string }).id
  for (let i = 0; i < 60; i++) {
    const p = (await (await request.get(`/api/projects/${projectId}`)).json()) as { status: string }
    if (p.status === 'ready') return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('el proyecto de prueba no terminó de procesarse')
})

test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${projectId}`)
})

async function expectAccessible(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  const blocking = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`accesibilidad (tema ${theme === 'dark' ? 'oscuro' : 'claro'})`, () => {
    test.skip(({ isMobile }) => isMobile, 'se audita en escritorio')
    test.beforeEach(async ({ page }) => setTheme(page, theme))

    test('inicio, captura y 404', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Tus planos' })).toBeVisible()
      await expect(page.locator(`a[href="/p/${projectId}"]`)).toBeVisible()
      await expectAccessible(page, 'inicio')
      await page.goto('/nuevo')
      await expectAccessible(page, 'nuevo')
      await page.getByTestId('file-input').setInputFiles(PHOTO)
      await expectAccessible(page, 'vista previa')
      await page.goto('/p/no-existe')
      await expect(page.getByRole('alert')).toBeVisible()
      await expectAccessible(page, '404')
    })

    test('editor y recorrido', async ({ page }) => {
      await page.goto(`/p/${projectId}`)
      await expect(page.getByRole('toolbar')).toBeVisible()
      await expectAccessible(page, 'editor')
      await page.goto(`/p/${projectId}/3d`)
      await expect(page.getByRole('radio', { name: 'Orbitar' })).toBeVisible()
      await expectAccessible(page, 'recorrido')
    })
  })
}

test.describe('escritorio', () => {
  test.skip(({ isMobile }) => isMobile, 'solo escritorio')

  test('teclado: se selecciona y edita un ambiente sin tocar el mouse', async ({ page }) => {
    await page.goto(`/p/${projectId}`)
    await expect(page.getByRole('toolbar')).toBeVisible()
    const item = page.getByRole('button', { name: /Espacio 1/ }).first()
    await item.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Ambiente' })).toBeVisible()
    await page.getByLabel('Nombre').fill('Dormitorio')
    await page.keyboard.press('Enter')
    await expect(page.getByText('cambios sin guardar')).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(page.getByText('guardado', { exact: true })).toBeVisible()
  })

  test('avisa antes de perder cambios al navegar dentro de la app', async ({ page }) => {
    await page.goto(`/p/${projectId}`)
    await page.getByRole('button', { name: /Espacio 1/ }).first().click()
    await page.getByLabel('Nombre').fill('Temporal')
    await page.getByRole('button', { name: 'Renombrar' }).click()
    await page.getByRole('link', { name: 'Proyectos', exact: true }).last().click()
    await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible()
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(page).toHaveURL(new RegExp(`/p/${projectId}$`))
    await page.getByRole('link', { name: 'Proyectos', exact: true }).last().click()
    await page.getByRole('button', { name: 'Salir sin guardar' }).click()
    await expect(page.getByRole('heading', { name: 'Tus planos' })).toBeVisible()
  })

  test('el foco siempre es visible al tabular', async ({ page }) => {
    await page.goto('/nuevo')
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const outline = await page.evaluate(() => {
        const el = document.activeElement
        return el && el !== document.body ? getComputedStyle(el).outlineStyle : 'n/a'
      })
      expect(outline).not.toBe('none')
    }
  })
})

test.describe('celular', () => {
  test.skip(({ isMobile }) => !isMobile, 'solo celular')

  async function smallTargets(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      [...document.querySelectorAll('a,button,input,[role=slider],[role=tab],[role=radio]')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          const hidden = r.width === 0 || getComputedStyle(el).visibility === 'hidden' || el.closest('.sr-only')
          return !hidden && (r.width < 44 || r.height < 44)
        })
        .map((el) => `${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 25)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
    )
  }

  test('objetivos táctiles de al menos 44 px y sin scroll horizontal', async ({ page }) => {
    for (const url of ['/', '/nuevo', `/p/${projectId}`, `/p/${projectId}/3d`]) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      expect(await smallTargets(page), url).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBeLessThanOrEqual(0)
    }
  })

  test('320 px: el botón principal queda a la vista tras ajustar esquinas', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/nuevo')
    await page.getByTestId('file-input').setInputFiles(PHOTO)
    await page.getByRole('button', { name: 'Ajustar esquinas' }).click()
    await expect(page.getByRole('button', { name: 'Convertir a 3D' })).toBeInViewport()
  })

  test('el recorrido deja ver el modelo: panel plegado y joystick sin tapar', async ({ page }) => {
    await page.goto(`/p/${projectId}/3d`)
    const toggle = page.getByRole('button', { name: /^Ambientes/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('radio', { name: 'Recorrer' }).click()
    const joy = (await page.getByRole('application', { name: /Joystick/ }).boundingBox())!
    const panel = (await toggle.boundingBox())!
    expect(joy.x).toBeGreaterThan(panel.x + panel.width)
    await toggle.click()
    await expect(page.getByRole('navigation', { name: 'Ambientes' })).toBeVisible()
  })

  test('Guardar y Recorrer siempre a la vista en la barra del editor', async ({ page }) => {
    await page.goto(`/p/${projectId}`)
    await expect(page.getByRole('button', { name: /guardado|Guardar/ })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('link', { name: 'Recorrer en 3D' })).toBeInViewport({ ratio: 1 })
  })

  test('las pistas del editor hablan de gestos táctiles, no de mouse', async ({ page }) => {
    await page.goto(`/p/${projectId}`)
    await expect(page.getByText(/pellizca/)).toBeVisible()
    await expect(page.getByText(/rueda para zoom/)).toHaveCount(0)
  })
})
