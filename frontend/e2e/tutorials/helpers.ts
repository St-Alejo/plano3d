/**
 * Utilidades para grabar los tutoriales en video con Playwright: el navegador sin
 * interfaz no dibuja el cursor, así que se inyecta uno (con un pulso al hacer clic),
 * y una franja de subtítulos que explica cada paso.
 */
import type { Page } from '@playwright/test'

// ventana de escritorio (el editor completo aparece desde 1024 px) grabada a 960×540 para que pese poco
export const VIEWPORT = { width: 1280, height: 720 }
export const VIDEO = { width: 960, height: 540 }

/** Se inyecta antes de cargar cada página: cursor visible y franja de subtítulos. */
export async function installOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ready = () => {
      if (document.getElementById('tut-cursor')) return
      const style = document.createElement('style')
      style.textContent = `
        #tut-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;
          transform:translate(-3px,-2px);transition:transform .02s}
        #tut-cursor svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
        .tut-ripple{position:fixed;z-index:2147483646;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
          border:3px solid #23845f;pointer-events:none;animation:tut-r .5s ease-out forwards}
        @keyframes tut-r{from{transform:scale(.3);opacity:1}to{transform:scale(1.3);opacity:0}}
        #tut-caption{position:fixed;z-index:2147483645;left:50%;top:64px;transform:translateX(-50%);max-width:80%;
          padding:10px 18px;border-radius:12px;background:rgba(20,28,24,.88);color:#fff;font:600 17px/1.35 system-ui,sans-serif;
          text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.25);transition:opacity .25s;opacity:0;pointer-events:none}
        #tut-caption small{display:block;font-weight:400;font-size:13px;opacity:.8;margin-top:2px}`
      document.head.appendChild(style)
      const cur = document.createElement('div')
      cur.id = 'tut-cursor'
      cur.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
      document.body.appendChild(cur)
      const cap = document.createElement('div')
      cap.id = 'tut-caption'
      document.body.appendChild(cap)
      window.addEventListener('mousemove', (e) => (cur.style.left = `${e.clientX}px`, cur.style.top = `${e.clientY}px`), true)
      window.addEventListener(
        'mousedown',
        (e) => {
          const r = document.createElement('div')
          r.className = 'tut-ripple'
          r.style.left = `${e.clientX}px`
          r.style.top = `${e.clientY}px`
          document.body.appendChild(r)
          setTimeout(() => r.remove(), 600)
        },
        true,
      )
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
    else ready()
  })
}

export async function caption(page: Page, title: string, detail = ''): Promise<void> {
  await page.evaluate(
    ([t, d]) => {
      const el = document.getElementById('tut-caption')
      if (!el) return
      el.innerHTML = ''
      el.append(t!)
      if (d) {
        const s = document.createElement('small')
        s.textContent = d
        el.append(s)
      }
      el.style.opacity = '1'
    },
    [title, detail],
  )
  await page.waitForTimeout(400)
}

export const pause = (page: Page, ms = 900) => page.waitForTimeout(ms)

let last = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }

/** Movimiento suave del ratón (se ve en el video). */
export async function glide(page: Page, to: { x: number; y: number }, steps = 22): Promise<void> {
  const from = last
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e)
    await page.waitForTimeout(16)
  }
  last = to
}

export async function clickAt(page: Page, p: { x: number; y: number }): Promise<void> {
  await glide(page, p)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
}

export async function dragFrom(page: Page, a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> {
  await glide(page, a)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await glide(page, b, 34)
  await page.waitForTimeout(150)
  await page.mouse.up()
}

/** Centro de un elemento en pantalla. */
export async function centerOf(page: Page, locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const b = (await locator.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

export async function clickEl(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await clickAt(page, await centerOf(page, locator))
}

/** Escribe como una persona (se ve tecla a tecla en el video). */
export async function typeSlow(page: Page, locator: ReturnType<Page['locator']>, text: string): Promise<void> {
  await clickEl(page, locator)
  await locator.pressSequentially(text, { delay: 45 })
}

/** Punto del plano (m) → pantalla, con la transformación real del lienzo de Konva. */
export async function screenOf(page: Page, mpp: number, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const local = await page.evaluate(
    ({ x, y }) => {
      const k = (window as unknown as { Konva: { stages: { getAbsoluteTransform(): { point(p: object): { x: number; y: number } } }[] } }).Konva
      return k.stages[0]!.getAbsoluteTransform().point({ x, y })
    },
    { x: p.x / mpp, y: p.y / mpp },
  )
  const box = (await page.locator('[data-testid=editor2d] canvas').first().boundingBox())!
  return { x: box.x + local.x, y: box.y + local.y }
}
