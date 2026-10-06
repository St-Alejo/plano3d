// Auditoría exploratoria de usabilidad (no es un test): node e2e/usability-audit.mjs <salida>
// Recorre escenarios reales, captura pantallas y registra hallazgos en findings.json.
import AxeBuilder from '@axe-core/playwright'
import { chromium, devices } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = process.argv[2] ?? 'test-results/usability'
mkdirSync(out, { recursive: true })
const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const photo = fileURLToPath(new URL('./fixtures/plano-foto.jpg', import.meta.url))
const findings = []
const note = (scenario, severity, msg, extra = {}) => {
  findings.push({ scenario, severity, msg, ...extra })
  console.log(`[${scenario}] ${severity}: ${msg}`)
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` })
const t0 = () => performance.now()

async function axe(page, scenario, label) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze()
  for (const v of res.violations) {
    note(scenario, v.impact ?? 'minor', `axe ${label}: ${v.id} — ${v.help}`, {
      nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + n.failureSummary?.split('\n')[1]),
    })
  }
  return res.violations.length
}

async function smallTargets(page, scenario, label) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('a,button,input,[role=slider],[role=tab],[role=radio]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && (r.width < 44 || r.height < 44) && !el.classList.contains('sr-only')
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
  )
  if (small.length) note(scenario, 'moderate', `${label}: ${small.length} objetivos táctiles < 44px`, { nodes: small.slice(0, 12) })
}

async function overflow(page, scenario, label) {
  const px = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (px > 0) note(scenario, 'serious', `${label}: scroll horizontal de ${px}px`)
}

async function upload(page, opts = {}) {
  await page.goto(`${base}/nuevo`)
  await page.getByTestId('file-input').setInputFiles(photo)
  if (opts.name) await page.getByLabel('Nombre del proyecto').fill(opts.name)
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()
  await page.waitForURL(/\/p\/prj_/)
  return page.url().split('/p/')[1]
}

const browser = await chromium.launch()
const created = []

// ------------------------------------------------------------------ S1 usuario nuevo (escritorio)
{
  const S = 'S1-primera-vez'
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${base}/proyectos`)
  await shot(page, 's1-01-inicio')
  await axe(page, S, 'inicio')
  let t = t0()
  await page.getByRole('link', { name: /Nuevo plano/ }).click()
  await axe(page, S, 'nuevo')
  await page.getByTestId('file-input').setInputFiles(photo)
  await shot(page, 's1-02-vista-previa')
  await axe(page, S, 'vista previa')
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()
  await page.waitForURL(/\/p\/prj_/)
  created.push(page.url().split('/p/')[1])
  await page.waitForTimeout(400)
  await shot(page, 's1-03-procesando')
  await page.getByRole('toolbar').waitFor({ timeout: 90_000 })
  const secs = ((t0() - t) / 1000).toFixed(1)
  note(S, 'info', `foto → editor listo en ${secs}s`)
  await page.waitForTimeout(2000)
  await shot(page, 's1-04-editor')
  await axe(page, S, 'editor')
  // ¿entiende qué hacer? se busca una guía de primer uso o llamado a la acción
  const hasGuide = await page.getByText(/Selecciona un muro/).isVisible()
  note(S, hasGuide ? 'info' : 'moderate', hasGuide ? 'hay texto guía en el panel' : 'no hay guía de primer uso en el editor')
  // botón deshabilitado "Guardar" sin explicación visible
  await page.getByRole('link', { name: 'Recorrer' }).click()
  await page.waitForTimeout(2500)
  await shot(page, 's1-05-recorrido')
  await axe(page, S, 'recorrido')
  await page.getByRole('radio', { name: 'Recorrer' }).click()
  await page.waitForTimeout(800)
  await shot(page, 's1-06-modo-caminar')
  if (errors.length) note(S, 'serious', `errores de consola: ${errors.length}`, { nodes: errors.slice(0, 5) })
  await page.close()
}

// ------------------------------------------------------------------ S2 solo teclado
{
  const S = 'S2-teclado'
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await page.goto(`${base}/proyectos`)
  const order = []
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    order.push(await page.evaluate(() => {
      const el = document.activeElement
      const r = el.getBoundingClientRect()
      const outline = getComputedStyle(el).outlineStyle
      return `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 25)} [foco ${outline !== 'none' ? 'visible' : 'NO visible'}] ${Math.round(r.x)},${Math.round(r.y)}`
    }))
  }
  note(S, 'info', 'orden de tabulación en inicio', { nodes: order })
  // `body` recibe el foco cuando se sale hacia la barra del navegador: no es un elemento de la app
  if (order.some((o) => o.includes('NO visible') && !o.startsWith('body'))) note(S, 'serious', 'hay elementos con foco no visible')
  // flujo de captura sin mouse
  await page.goto(`${base}/nuevo`)
  await page.keyboard.press('Tab')
  let reachedUpload = false
  for (let i = 0; i < 12; i++) {
    const name = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    if (name.includes('Subir archivo')) {
      reachedUpload = true
      break
    }
    await page.keyboard.press('Tab')
  }
  note(S, reachedUpload ? 'info' : 'critical', reachedUpload ? '"Subir archivo" alcanzable con Tab' : '"Subir archivo" NO alcanzable con teclado')
  // editor: ¿se puede seleccionar un muro sin mouse?
  const id = created[0]
  await page.goto(`${base}/p/${id}`)
  await page.getByRole('toolbar').waitFor({ timeout: 60_000 })
  let canSelect = false
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => document.activeElement?.closest('[data-testid=editor2d]') !== null || document.activeElement?.getAttribute('aria-label')?.includes('muro'))
    if (info) {
      canSelect = true
      break
    }
  }
  note(S, canSelect ? 'info' : 'serious', canSelect ? 'se puede llegar al lienzo 2D con Tab' : 'el editor 2D no es operable con teclado: no hay forma de seleccionar muros/ambientes sin mouse')
  await shot(page, 's2-editor-teclado')
  await page.close()
}

// ------------------------------------------------------------------ S3 celular 360 px y 320 px
for (const [label, dev] of [['360', devices['Galaxy S9+']], ['320', { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } }]]) {
  const S = `S3-movil-${label}`
  const ctx = await browser.newContext({ ...dev })
  const page = await ctx.newPage()
  await page.goto(`${base}/proyectos`)
  await overflow(page, S, 'inicio')
  await smallTargets(page, S, 'inicio')
  await shot(page, `s3-${label}-01-inicio`)
  await page.goto(`${base}/nuevo`)
  await overflow(page, S, 'nuevo')
  await smallTargets(page, S, 'nuevo')
  await shot(page, `s3-${label}-02-nuevo`)
  await page.getByTestId('file-input').setInputFiles(photo)
  await page.getByRole('button', { name: 'Ajustar esquinas' }).click()
  await page.waitForTimeout(1200)
  await shot(page, `s3-${label}-03-esquinas`)
  const cta = await page.getByRole('button', { name: 'Convertir a 3D' }).boundingBox()
  const vh = page.viewportSize().height
  if (cta && cta.y > vh) note(S, 'moderate', `el botón "Convertir a 3D" queda fuera de la pantalla (y=${Math.round(cta.y)} > ${vh}); hay que desplazarse para encontrarlo`)
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()
  await page.waitForURL(/\/p\/prj_/)
  created.push(page.url().split('/p/')[1])
  await page.getByRole('tab', { name: 'Plano 2D' }).waitFor({ timeout: 90_000 })
  await page.waitForTimeout(1500)
  await overflow(page, S, 'editor')
  await smallTargets(page, S, 'editor')
  await shot(page, `s3-${label}-04-editor`)
  // toolbar: ¿entra sin desbordar?
  const tb = await page.getByRole('toolbar').boundingBox()
  if (tb && tb.height > 60) note(S, 'minor', `la barra de herramientas ocupa ${Math.round(tb.height)}px (se parte en varias líneas)`)
  // tocar un ambiente en 2D
  const canvas = page.getByTestId('editor2d')
  const box = await canvas.boundingBox()
  await page.touchscreen.tap(box.x + box.width * 0.35, box.y + box.height * 0.45)
  await page.waitForTimeout(300)
  await page.getByRole('tab', { name: 'Detalles' }).click()
  const selected = await page.getByRole('heading', { name: /Ambiente|Muro|Puerta|Ventana/ }).count()
  note(S, selected ? 'info' : 'serious', selected ? 'tocar el plano selecciona un elemento' : 'tocar el plano no seleccionó nada')
  await shot(page, `s3-${label}-05-detalles`)
  await page.goto(`${base}/p/${created.at(-1)}/3d`)
  await page.waitForTimeout(2500)
  await overflow(page, S, 'recorrido')
  await smallTargets(page, S, 'recorrido')
  await shot(page, `s3-${label}-06-recorrido`)
  await page.getByRole('radio', { name: 'Recorrer' }).click()
  await page.waitForTimeout(600)
  await shot(page, `s3-${label}-07-joystick`)
  const joystick = await page.getByRole('application', { name: /Joystick/ }).count()
  note(S, joystick ? 'info' : 'serious', joystick ? 'joystick visible en modo Recorrer' : 'no aparece el joystick táctil')
  // panel inferior vs joystick: ¿se tapan?
  const panel = await page.getByRole('button', { name: /^Ambientes/ }).boundingBox()
  const joy = await page.getByRole('application', { name: /Joystick/ }).boundingBox().catch(() => null)
  const covered = panel && joy ? (joy.y < panel.y + panel.height && panel.y < joy.y + joy.height && joy.x < panel.x + panel.width) : false
  const visible3d = await page.evaluate(() => {
    const c = document.querySelector('canvas')?.getBoundingClientRect()
    const overlays = [...document.querySelectorAll('.absolute .rounded-md, .absolute.inset-x-0 > div')].reduce((a, e) => a + e.getBoundingClientRect().width * e.getBoundingClientRect().height, 0)
    return c ? Math.max(0, 1 - overlays / (c.width * c.height)) : 0
  })
  if (covered) note(S, 'serious', 'el joystick se superpone al panel de ambientes')
  if (visible3d < 0.55) note(S, 'moderate', `los paneles tapan ~${Math.round((1 - visible3d) * 100)}% de la vista 3D`)
  await ctx.close()
}

// ------------------------------------------------------------------ S4 tema claro
{
  const S = 'S4-tema-claro'
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage()
  await page.goto(`${base}/proyectos`)
  await page.getByRole('button', { name: 'Usar tema claro' }).click()
  await shot(page, 's4-01-inicio-claro')
  await axe(page, S, 'inicio claro')
  await page.goto(`${base}/p/${created[0]}`)
  await page.getByRole('toolbar').waitFor()
  await page.waitForTimeout(1500)
  await shot(page, 's4-02-editor-claro')
  await axe(page, S, 'editor claro')
  await page.goto(`${base}/p/${created[0]}/3d`)
  await page.waitForTimeout(2000)
  await shot(page, 's4-03-recorrido-claro')
  await page.evaluate(() => localStorage.setItem('theme', 'dark'))
  await page.close()
}

// ------------------------------------------------------------------ S5 zoom 200 % (WCAG 1.4.10)
{
  const S = 'S5-zoom-200'
  const page = await (await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 })).newPage()
  await page.goto(`${base}/proyectos`)
  await overflow(page, S, 'inicio')
  await shot(page, 's5-01-inicio')
  await page.goto(`${base}/p/${created[0]}`)
  await page.getByRole('tab', { name: 'Plano 2D' }).waitFor()
  await overflow(page, S, 'editor')
  await shot(page, 's5-02-editor')
  await page.close()
}

// ------------------------------------------------------------------ S6 red lenta y servidor caído
{
  const S = 'S6-red'
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 25_000 })
  let t = t0()
  await page.goto(`${base}/proyectos`)
  await page.getByRole('heading', { name: 'Tus planos' }).waitFor({ timeout: 60_000 })
  note(S, 'info', `inicio en red 3G lenta: ${((t0() - t) / 1000).toFixed(1)}s`)
  await page.getByRole('link', { name: /Nuevo plano/ }).click()
  await page.getByTestId('file-input').setInputFiles(photo)
  t = t0()
  await page.getByRole('button', { name: 'Convertir a 3D' }).click()
  await page.waitForTimeout(500)
  const busy = await page.getByRole('button', { name: 'Convertir a 3D' }).isDisabled()
  note(S, busy ? 'info' : 'serious', busy ? 'el botón queda ocupado mientras sube (evita doble envío)' : 'el botón no indica la subida en curso')
  await shot(page, 's6-01-subiendo-lento')
  await page.waitForURL(/\/p\/prj_/, { timeout: 90_000 })
  created.push(page.url().split('/p/')[1])
  note(S, 'info', `subida de 120 KB en red lenta: ${((t0() - t) / 1000).toFixed(1)}s (sin barra de progreso de subida)`)
  // servidor caído
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await page.route('**/api/**', (r) => r.abort())
  await page.goto(`${base}/proyectos`)
  await page.waitForTimeout(1500)
  await shot(page, 's6-02-servidor-caido')
  const msg = await page.getByRole('alert').textContent().catch(() => null)
  note(S, msg ? 'info' : 'serious', msg ? `mensaje con servidor caído: "${msg.trim().slice(0, 90)}"` : 'sin mensaje cuando el servidor no responde')
  await ctx.close()
}

// ------------------------------------------------------------------ S7 caminos de error
{
  const S = 'S7-errores'
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await page.goto(`${base}/nuevo`)
  await page.getByTestId('file-input').setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
  await shot(page, 's7-01-tipo-invalido')
  note(S, 'info', `tipo inválido: "${(await page.getByRole('alert').textContent())?.trim()}"`)
  await page.goto(`${base}/p/prj_noexiste`)
  await page.waitForTimeout(800)
  await shot(page, 's7-02-404')
  note(S, 'info', `proyecto inexistente: "${(await page.getByRole('alert').textContent())?.trim().slice(0, 80)}"`)
  await page.goto(`${base}/cualquier/cosa`)
  await shot(page, 's7-03-ruta-desconocida')
  // edición imposible
  await page.goto(`${base}/p/${created[0]}`)
  await page.getByRole('toolbar').waitFor()
  await page.keyboard.press('w')
  const c = await page.getByTestId('editor2d').boundingBox()
  await page.mouse.move(c.x + 50, c.y + 50)
  await page.mouse.down()
  await page.mouse.move(c.x + 52, c.y + 51)
  await page.mouse.up()
  const err = await page.getByRole('alert').count()
  note(S, 'info', `trazar un muro diminuto: ${err ? 'muestra error' : 'se ignora en silencio (correcto: no crea basura)'}`)
  await page.close()
}

// ------------------------------------------------------------------ S8 movimiento reducido
{
  const S = 'S8-movimiento-reducido'
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`${base}/p/${created[0]}/3d`)
  await page.waitForTimeout(300)
  await shot(page, 's8-01-sin-animacion-300ms')
  note(S, 'info', 'captura a 300 ms: con movimiento reducido los muros deben verse completos, sin animación de crecimiento')
  await ctx.close()
}

// ------------------------------------------------------------------ S9 cambios sin guardar
{
  const S = 'S9-cambios-sin-guardar'
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await page.goto(`${base}/p/${created[0]}`)
  await page.getByRole('toolbar').waitFor()
  await page.waitForTimeout(1000)
  const c = await page.getByTestId('editor2d').boundingBox()
  await page.mouse.click(c.x + c.width * 0.3, c.y + c.height * 0.45)
  if (await page.getByLabel('Nombre').isVisible().catch(() => false)) {
    await page.getByLabel('Nombre').fill('Living')
    await page.getByRole('button', { name: 'Renombrar' }).click()
  }
  let dialog = null
  page.once('dialog', async (d) => {
    dialog = d.message()
    await d.dismiss()
  })
  await page.getByRole('link', { name: 'Proyectos', exact: true }).first().click()
  await page.waitForTimeout(800)
  const stayed = page.url().includes('/p/')
  note(S, stayed || dialog ? 'info' : 'serious', stayed || dialog ? 'avisa antes de perder cambios al navegar' : 'navegar a Proyectos con cambios sin guardar los pierde SIN aviso')
  await shot(page, 's9-01-despues-de-navegar')
  await page.close()
}

// ------------------------------------------------------------------ S10 objetivos táctiles escritorio / densidad
{
  const S = 'S10-densidad'
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 700 } })).newPage()
  await page.goto(`${base}/p/${created[0]}`)
  await page.getByRole('toolbar').waitFor()
  await page.waitForTimeout(1500)
  await overflow(page, S, 'editor 1024px')
  await shot(page, 's10-01-editor-1024')
  await page.close()
}

writeFileSync(`${out}/findings.json`, JSON.stringify(findings, null, 2))
// limpieza de proyectos creados por la auditoría
const api = await (await browser.newContext()).request
for (const id of created) await api.delete(`${base}/api/projects/${id}`)
await browser.close()
const bySev = findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {})
console.log('\nRESUMEN', JSON.stringify(bySev))
