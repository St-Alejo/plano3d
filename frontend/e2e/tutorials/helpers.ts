/**
 * Utilidades para grabar los tutoriales en video con Playwright (guion en GUION.md).
 *
 * El navegador sin interfaz no dibuja el cursor, así que se inyecta uno, más una capa animada:
 * - rótulo corto (máx. 4 palabras por escena, contando también las etiquetas de los dibujos;
 *   las magnitudes con unidad, como "5 m", no cuentan como palabras),
 * - subtítulo con la palabra clave, que se enciende con `hit()` en el instante de la acción,
 * - foco (oscurece todo menos el objetivo), regla de escala y cotas en metros,
 * - dibujos literales de las analogías (hoja, rebobinar, borrador, persona, teclas…),
 * - riel de pasos persistente.
 */
import type { Page } from '@playwright/test'

// ventana de escritorio (el editor completo aparece desde 1024 px) grabada a 960×540 para que pese poco
export const VIEWPORT = { width: 1280, height: 720 }
export const VIDEO = { width: 960, height: 540 }

type Pt = { x: number; y: number }
type Box = { x: number; y: number; width: number; height: number }

const CSS = `
:root{--tut-brick:#a84b26;--tut-ink:#1a1c1b;--tut-bone:#f2eee6}
#tut-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;transform:translate(-3px,-2px)}
#tut-cursor svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
.tut-ripple{position:fixed;z-index:2147483646;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
  border:3px solid var(--tut-brick);pointer-events:none;animation:tut-r .5s ease-out forwards}
@keyframes tut-r{from{transform:scale(.3);opacity:1}to{transform:scale(1.3);opacity:0}}
#tut-layer{position:fixed;inset:0;z-index:2147483640;pointer-events:none;font-family:'Hanken Grotesk Variable',system-ui,sans-serif}
#tut-focus{position:fixed;border-radius:14px;box-shadow:0 0 0 200vmax rgba(18,20,19,.55);outline:3px solid var(--tut-brick);
  outline-offset:3px;transition:all .45s cubic-bezier(.2,.7,.2,1),opacity .35s;opacity:0}
#tut-title{position:fixed;left:50%;top:70px;transform:translate(-50%,-8px);padding:10px 22px 12px;border-radius:14px;
  background:var(--tut-ink);color:var(--tut-bone);font:600 34px/1 'Fraunces Variable',Georgia,serif;letter-spacing:-.01em;
  box-shadow:0 14px 30px -12px rgba(0,0,0,.5);opacity:0;transition:opacity .3s,transform .4s cubic-bezier(.2,.7,.2,1);white-space:nowrap}
#tut-title.on{opacity:1;transform:translate(-50%,0)}
#tut-sub{position:fixed;left:50%;bottom:6px;transform:translateX(-50%);max-width:78%;padding:8px 16px;border-radius:10px;
  background:rgba(18,20,19,.82);color:#fff;font:500 19px/1.35 'Hanken Grotesk Variable',system-ui,sans-serif;text-align:center;
  opacity:0;transition:opacity .25s}
#tut-sub.on{opacity:1}
#tut-sub b{font-weight:700;padding:0 3px;border-radius:4px;background:linear-gradient(var(--tut-brick),var(--tut-brick)) no-repeat 0 100%/0% 100%;
  transition:background-size .28s ease-out,color .28s}
#tut-sub.hit b{background-size:100% 100%;color:#fff}
#tut-rail{position:fixed;right:22px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:9px}
#tut-rail i{display:block;width:9px;height:9px;border-radius:50%;background:rgba(26,28,27,.25);transition:all .35s}
#tut-rail i.done{background:var(--tut-brick)}
#tut-rail i.now{background:var(--tut-brick);transform:scale(1.6);box-shadow:0 0 0 4px rgba(168,75,38,.25)}
#tut-ruler{position:fixed;left:22px;bottom:48px;color:var(--tut-ink);font:600 13px/1 'JetBrains Mono',monospace;transition:opacity .3s;opacity:0}
#tut-ruler .bar{height:8px;border:2px solid var(--tut-ink);border-top:0;background:repeating-linear-gradient(90deg,var(--tut-ink) 0 var(--seg),transparent var(--seg) calc(var(--seg)*2));
  transition:width .45s cubic-bezier(.2,.7,.2,1);box-shadow:0 0 0 3px rgba(242,238,230,.85)}
#tut-ruler span{display:inline-block;margin-top:5px;padding:2px 5px;background:rgba(242,238,230,.9);border-radius:4px}
#tut-art{position:fixed;inset:0;width:100%;height:100%;overflow:visible}
#tut-art .draw{stroke-dasharray:var(--len);stroke-dashoffset:var(--len);animation:tut-draw var(--dur,.6s) ease-out forwards}
@keyframes tut-draw{to{stroke-dashoffset:0}}
#tut-art .pop{transform-box:fill-box;transform-origin:center;animation:tut-pop .35s cubic-bezier(.2,1.4,.4,1) both}
@keyframes tut-pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
#tut-art text{font:700 15px 'JetBrains Mono',monospace;paint-order:stroke;stroke:rgba(242,238,230,.95);stroke-width:5px}
.tut-fade{transition:opacity .35s}`

/** Se inyecta antes de cargar cada página: cursor visible y la capa animada vacía. */
export async function installOverlay(page: Page): Promise<void> {
  await page.addInitScript((css) => {
    const ready = () => {
      if (document.getElementById('tut-cursor')) return
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)
      const cur = document.createElement('div')
      cur.id = 'tut-cursor'
      cur.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
      const layer = document.createElement('div')
      layer.id = 'tut-layer'
      layer.innerHTML =
        '<div id="tut-focus"></div><svg id="tut-art" xmlns="http://www.w3.org/2000/svg"></svg><div id="tut-title"></div>' +
        '<div id="tut-sub"></div><div id="tut-rail"></div><div id="tut-ruler"><div class="bar"></div><span></span></div>'
      document.body.append(layer, cur)
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
  }, CSS)
}

/** Palabras en pantalla (sin las magnitudes "5 m", "2,6 m", "18 cm"…). */
export function wordCount(text: string): number {
  return text
    .replace(/\d+([.,]\d+)?\s*(m|cm|mm|m²)?\b/g, ' ')
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length
}

let sceneWords = 0
const budget = (text: string) => {
  sceneWords += wordCount(text)
  if (sceneWords > 4) throw new Error(`más de 4 palabras en pantalla en esta escena (${sceneWords}): «${text}»`)
}

/**
 * Empieza una escena: borra los dibujos de la anterior (el cursor, la regla y el riel quedan),
 * pone el rótulo y el subtítulo. En `sub`, la palabra clave va entre *asteriscos*.
 */
export async function scene(page: Page, opts: { title: string; sub: string; step: number; steps: number }): Promise<void> {
  sceneWords = 0
  budget(opts.title)
  await page.evaluate(({ title, sub, step, steps }) => {
    const $ = (id: string) => document.getElementById(id)!
    const art = $('tut-art')
    for (const el of Array.from(art.children)) {
      ;(el as SVGElement).style.transition = 'opacity .3s'
      ;(el as SVGElement).style.opacity = '0'
      setTimeout(() => el.remove(), 320)
    }
    $('tut-focus').style.opacity = '0'
    const t = $('tut-title')
    t.classList.remove('on')
    const s = $('tut-sub')
    s.classList.remove('on', 'hit')
    setTimeout(() => {
      t.textContent = title
      t.classList.add('on')
      s.innerHTML = sub.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\*([^*]+)\*/g, '<b>$1</b>')
      s.classList.add('on')
    }, 260)
    const rail = $('tut-rail')
    if (rail.children.length !== steps) rail.innerHTML = '<i></i>'.repeat(steps)
    Array.from(rail.children).forEach((d, i) => (d.className = i < step ? 'done' : i === step ? 'now' : ''))
  }, opts)
  await page.waitForTimeout(650)
}

/** Enciende la palabra clave del subtítulo: llamarlo justo cuando ocurre la acción. */
export async function hit(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('tut-sub')!.classList.add('hit'))
}

/** Foco: oscurece todo menos el recuadro (con margen). `null` lo quita. */
export async function focus(page: Page, box: Box | null, pad = 8): Promise<void> {
  await page.evaluate(
    ({ box, pad }) => {
      const f = document.getElementById('tut-focus')!
      if (!box) return void (f.style.opacity = '0')
      // si estaba apagado, aparece ya en su sitio (sin viajar desde el foco anterior)
      if (f.style.opacity !== '1') {
        f.style.transition = 'opacity .35s'
        Object.assign(f.style, { left: `${box.x - pad}px`, top: `${box.y - pad}px`, width: `${box.width + 2 * pad}px`, height: `${box.height + 2 * pad}px` })
        void f.offsetWidth
        f.style.transition = ''
      }
      Object.assign(f.style, {
        left: `${box.x - pad}px`, top: `${box.y - pad}px`, width: `${box.width + 2 * pad}px`, height: `${box.height + 2 * pad}px`, opacity: '1',
      })
    },
    { box, pad },
  )
}

export async function focusEl(page: Page, locator: ReturnType<Page['locator']>, pad = 8): Promise<void> {
  await focus(page, await locator.boundingBox(), pad)
}

/** Regla de escala persistente: `pxPerM` píxeles por metro en pantalla, `meters` de largo. */
export async function ruler(page: Page, pxPerM: number | null, meters = 1): Promise<void> {
  await page.evaluate(
    ({ pxPerM, meters }) => {
      const r = document.getElementById('tut-ruler')!
      if (!pxPerM) return void (r.style.opacity = '0')
      const bar = r.querySelector<HTMLElement>('.bar')!
      bar.style.width = `${pxPerM * meters}px`
      bar.style.setProperty('--seg', `${pxPerM / 2}px`)
      r.querySelector('span')!.textContent = `${meters} m`.replace('.', ',')
      r.style.opacity = '1'
    },
    { pxPerM, meters },
  )
}

/** Agrega SVG a la capa de dibujos (se borra al empezar la escena siguiente). */
async function svg(page: Page, markup: string): Promise<void> {
  await page.evaluate((markup) => {
    const art = document.getElementById('tut-art')!
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.innerHTML = markup
    art.appendChild(g)
    // largo real de cada trazo para la animación de dibujo
    g.querySelectorAll<SVGGeometryElement>('.draw').forEach((p) => p.style.setProperty('--len', `${Math.ceil(p.getTotalLength())}`))
  }, markup)
}

const BRICK = '#a84b26'
const INK = '#1a1c1b'

/** Cota animada entre dos puntos de pantalla con su etiqueta ("5 m"). */
export async function dim(page: Page, a: Pt, b: Pt, label: string, offset = 18): Promise<void> {
  budget(label)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const n = { x: (-dy / len) * offset, y: (dx / len) * offset }
  const A = { x: a.x + n.x, y: a.y + n.y }
  const B = { x: b.x + n.x, y: b.y + n.y }
  const mid = { x: (A.x + B.x) / 2 + n.x * 0.9, y: (A.y + B.y) / 2 + n.y * 0.9 }
  await svg(
    page,
    `<line x1="${a.x}" y1="${a.y}" x2="${A.x}" y2="${A.y}" stroke="${BRICK}" stroke-width="1.5" opacity=".7"/>
     <line x1="${b.x}" y1="${b.y}" x2="${B.x}" y2="${B.y}" stroke="${BRICK}" stroke-width="1.5" opacity=".7"/>
     <path class="draw" d="M${A.x} ${A.y}L${B.x} ${B.y}" stroke="${BRICK}" stroke-width="2.5" fill="none" style="--dur:.7s"/>
     <circle class="pop" cx="${A.x}" cy="${A.y}" r="4" fill="${BRICK}"/><circle class="pop" cx="${B.x}" cy="${B.y}" r="4" fill="${BRICK}"/>
     <text class="pop" x="${mid.x}" y="${mid.y + 5}" text-anchor="middle" fill="${BRICK}" style="animation-delay:.45s">${label}</text>`,
  )
}

/** Anillo que late sobre un punto (para "aquí ocurre"). */
export async function pulse(page: Page, p: Pt, r = 22): Promise<void> {
  await svg(
    page,
    `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="none" stroke="${BRICK}" stroke-width="3">
       <animate attributeName="r" values="${r * 0.6};${r * 1.3};${r * 0.6}" dur="1.1s" repeatCount="indefinite"/>
       <animate attributeName="opacity" values="1;.35;1" dur="1.1s" repeatCount="indefinite"/></circle>`,
  )
}

/** Trayecto punteado con flecha (de dónde a dónde se mueve algo). */
export async function path(page: Page, a: Pt, b: Pt): Promise<void> {
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.25
  const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.25
  await svg(
    page,
    `<defs><marker id="tut-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
       <path d="M0 0L10 5L0 10z" fill="${BRICK}"/></marker></defs>
     <path class="draw" d="M${a.x} ${a.y}Q${mx} ${my} ${b.x} ${b.y}" stroke="${BRICK}" stroke-width="3" fill="none" stroke-linecap="round"
       stroke-dasharray="2 9" marker-end="url(#tut-arrow)" style="--dur:.8s"/>`,
  )
}

/** Analogía "hoja en blanco": una hoja cae sobre el lienzo y se asienta. */
export async function drawSheet(page: Page, box: Box): Promise<void> {
  await svg(
    page,
    `<g style="transform-origin:${box.x + box.width / 2}px ${box.y + box.height / 2}px;animation:tut-sheet 1.8s cubic-bezier(.2,.7,.2,1) both">
       <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="6" fill="#fbf9f4" stroke="${INK}" stroke-width="2"/>
       <path d="M${box.x + box.width - 48} ${box.y}l48 48h-48z" fill="#e6e0d4" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
     </g>
     <style>@keyframes tut-sheet{from{transform:translateY(-120%) rotate(-9deg);opacity:0}45%{opacity:1}70%{transform:none;opacity:1}to{transform:none;opacity:.55}}</style>`,
  )
}

/** Analogía "rebobinar": flecha circular que gira hacia atrás (Ctrl+Z). */
export async function drawRewind(page: Page, c: Pt, redo = false): Promise<void> {
  const r = 34
  const dir = redo ? 1 : -1
  await svg(
    page,
    `<g class="pop"><circle cx="${c.x}" cy="${c.y}" r="${r + 14}" fill="rgba(242,238,230,.92)" stroke="${INK}" stroke-width="2"/>
       <g style="transform-origin:${c.x}px ${c.y}px;animation:tut-spin .9s ease-in-out both">
         <path d="M${c.x + dir * r} ${c.y}A${r} ${r} 0 1 ${redo ? 1 : 0} ${c.x} ${c.y - r}" fill="none" stroke="${BRICK}" stroke-width="6" stroke-linecap="round"/>
         <path d="M${c.x - dir * 4} ${c.y - r - 12}l${dir * -14} ${12}l${dir * 14} ${12}z" fill="${BRICK}"/>
       </g></g>
     <style>@keyframes tut-spin{from{transform:rotate(0)}to{transform:rotate(${dir * 360}deg)}}</style>`,
  )
}

/** Analogía "borrador": un lápiz con goma pasa sobre el punto y lo deja en blanco. */
export async function drawEraser(page: Page, p: Pt, w = 70): Promise<void> {
  await svg(
    page,
    `<rect x="${p.x - w / 2}" y="${p.y - 9}" width="${w}" height="18" fill="#fbf9f4" style="transform-box:fill-box;transform-origin:left;animation:tut-wipe .7s .15s ease-out both"/>
     <g style="animation:tut-rub .7s .1s ease-in-out both">
       <g transform="translate(${p.x - w / 2} ${p.y - 64}) rotate(28)">
         <rect width="20" height="64" rx="3" fill="#e0b13a" stroke="${INK}" stroke-width="2"/>
         <rect y="52" width="20" height="18" rx="3" fill="#e58b8b" stroke="${INK}" stroke-width="2"/></g></g>
     <style>@keyframes tut-wipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
       @keyframes tut-rub{0%{transform:translateX(0)}50%{transform:translateX(${w}px)}100%{transform:translateX(${w * 0.4}px)}}</style>`,
  )
}

/** Analogía "estar adentro": silueta de persona con su estatura acotada. */
export async function drawPerson(page: Page, foot: Pt, heightPx: number): Promise<void> {
  const h = heightPx
  const x = foot.x
  const y = foot.y
  await svg(
    page,
    `<g style="animation:tut-drop .8s cubic-bezier(.3,1.3,.5,1) both">
       <circle cx="${x}" cy="${y - h + h * 0.08}" r="${h * 0.08}" fill="${BRICK}"/>
       <path d="M${x} ${y - h * 0.82}L${x} ${y - h * 0.42}M${x} ${y - h * 0.42}L${x - h * 0.12} ${y}M${x} ${y - h * 0.42}L${x + h * 0.12} ${y}
         M${x - h * 0.17} ${y - h * 0.66}L${x} ${y - h * 0.74}L${x + h * 0.17} ${y - h * 0.62}" stroke="${BRICK}" stroke-width="${Math.max(4, h * 0.06)}"
         stroke-linecap="round" fill="none"/></g>
     <style>@keyframes tut-drop{from{transform:translateY(-${h}px);opacity:0}to{transform:none;opacity:1}}</style>`,
  )
  await dim(page, { x: x + h * 0.3, y }, { x: x + h * 0.3, y: y - h }, '1,70 m', 0)
}

/** Teclas W A S D dibujadas; `down` hunde las indicadas. */
export async function drawKeys(page: Page, at: Pt, down: string[] = []): Promise<void> {
  const k = 38
  const key = (ch: string, dx: number, dy: number) => {
    const on = down.includes(ch)
    return `<g transform="translate(${at.x + dx} ${at.y + dy + (on ? 3 : 0)})"><rect width="${k}" height="${k}" rx="7" fill="${on ? BRICK : '#fbf9f4'}"
      stroke="${INK}" stroke-width="2" style="filter:drop-shadow(0 ${on ? 1 : 4}px 0 ${INK})"/>
      <text x="${k / 2}" y="${k / 2 + 6}" text-anchor="middle" fill="${on ? '#fff' : INK}" style="stroke:none">${ch}</text></g>`
  }
  await page.evaluate(() => document.getElementById('tut-keys')?.remove())
  await svg(page, `<g id="tut-keys">${key('W', k + 6, 0)}${key('A', 0, k + 6)}${key('S', k + 6, k + 6)}${key('D', 2 * (k + 6), k + 6)}</g>`)
}

/** Corte de escalera: `steps` peldaños de `riser` m, con su cota total; un punto sube por el perfil. */
export async function drawStairProfile(page: Page, origin: Pt, steps: number, riser: number, pxPerM: number, climb = 2.4): Promise<void> {
  const rise = riser * pxPerM
  const run = rise * 1.55
  let d = `M${origin.x} ${origin.y}`
  for (let i = 0; i < steps; i++) d += `v${-rise}h${run}`
  const top = { x: origin.x + steps * run, y: origin.y - steps * rise }
  await svg(
    page,
    `<rect x="${origin.x - 16}" y="${top.y - 30}" width="${top.x - origin.x + 120}" height="${origin.y - top.y + 50}" rx="10" fill="rgba(242,238,230,.94)" stroke="${INK}" stroke-width="1.5"/>
     <path class="draw" d="${d}" stroke="${INK}" stroke-width="3" fill="none" style="--dur:.9s"/>
     <circle r="7" fill="${BRICK}"><animateMotion dur="${climb}s" begin="0.9s" fill="freeze" path="M${origin.x + run / 2} ${origin.y - rise - 8}L${top.x - run / 2} ${top.y - 8}"/></circle>`,
  )
  await dim(page, { x: top.x + 30, y: origin.y }, { x: top.x + 30, y: top.y }, `${(steps * riser).toFixed(2).replace('.', ',')} m`, 0)
  await dim(page, { x: origin.x, y: origin.y + 4 }, { x: origin.x + run, y: origin.y + 4 }, '', 0)
  await svg(page, `<text class="pop" x="${origin.x + run + 18}" y="${origin.y - rise / 2 + 5}" fill="${BRICK}">${Math.round(riser * 100)} cm</text>`)
}

/** Riel de niveles: losas apiladas con su elevación; `current` en ladrillo. */
export async function drawLevels(page: Page, at: Pt, elevations: number[], current: number, pxPerM = 22): Promise<void> {
  const w = 120
  let out = ''
  elevations.forEach((e, i) => {
    const y = at.y - e * pxPerM
    const on = i === current
    out += `<g class="pop" style="animation-delay:${i * 0.15}s"><rect x="${at.x}" y="${y - 6}" width="${w}" height="8" rx="2" fill="${on ? BRICK : INK}"/>
      <text x="${at.x + w + 10}" y="${y + 1}" fill="${on ? BRICK : INK}" style="font-size:13px">${e.toFixed(1).replace('.', ',')} m</text></g>`
  })
  const top = at.y - elevations.at(-1)! * pxPerM
  await svg(
    page,
    `<rect x="${at.x - 14}" y="${top - 26}" width="${w + 86}" height="${at.y - top + 44}" rx="10" fill="rgba(242,238,230,.94)" stroke="${INK}" stroke-width="1.5"/>${out}`,
  )
}

/** Brújula con el lado que se nombra resaltado. */
export async function drawCompass(page: Page, c: Pt, side: 'N' | 'S' | 'E' | 'O'): Promise<void> {
  const ang = { N: -90, E: 0, S: 90, O: 180 }[side]
  await svg(
    page,
    `<g class="pop"><circle cx="${c.x}" cy="${c.y}" r="30" fill="rgba(242,238,230,.94)" stroke="${INK}" stroke-width="2"/>
       <text x="${c.x}" y="${c.y - 13}" text-anchor="middle" style="font-size:11px;stroke:none" fill="${INK}">N</text>
       <g transform="rotate(${ang} ${c.x} ${c.y})"><path d="M${c.x - 4} ${c.y}L${c.x + 22} ${c.y}" stroke="${BRICK}" stroke-width="4" stroke-linecap="round"/>
       <path d="M${c.x + 26} ${c.y}l-9 -7v14z" fill="${BRICK}"/></g></g>`,
  )
}

/** Rayo de mira desde el centro de la pantalla hasta un punto, con su largo. */
export async function drawRay(page: Page, from: Pt, to: Pt, label: string): Promise<void> {
  await svg(page, `<path class="draw" d="M${from.x} ${from.y}L${to.x} ${to.y}" stroke="${BRICK}" stroke-width="3" stroke-dasharray="10 6" fill="none"/>`)
  await dim(page, from, to, label, 16)
}

/** Franja de texto de los tutoriales anteriores (se quita cuando los tres usen `scene`). */
export async function caption(page: Page, title: string, detail = ''): Promise<void> {
  await page.evaluate(
    ([t, d]) => {
      const s = document.getElementById('tut-sub')!
      s.textContent = d ? `${t} — ${d}` : t!
      s.classList.add('on')
    },
    [title, detail],
  )
  await page.waitForTimeout(400)
}

export const pause = (page: Page, ms = 900) => page.waitForTimeout(ms)

/** Imagen final de la escena: todo quieto un momento antes de seguir. */
export const hold = (page: Page, ms = 900) => page.waitForTimeout(ms)

let last = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }

/** Movimiento suave del ratón (se ve en el video). */
export async function glide(page: Page, to: Pt, steps = 22): Promise<void> {
  const from = last
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e)
    await page.waitForTimeout(16)
  }
  last = to
}

export async function clickAt(page: Page, p: Pt): Promise<void> {
  await glide(page, p)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
}

export async function dragFrom(page: Page, a: Pt, b: Pt, onMove?: () => Promise<void>): Promise<void> {
  await glide(page, a)
  await page.mouse.down()
  await page.waitForTimeout(150)
  if (onMove) await onMove()
  await glide(page, b, 34)
  await page.waitForTimeout(150)
  await page.mouse.up()
}

/** Centro de un elemento en pantalla. */
export async function centerOf(page: Page, locator: ReturnType<Page['locator']>): Promise<Pt> {
  const b = (await locator.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

export async function clickEl(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await clickAt(page, await centerOf(page, locator))
}

/** Escribe como una persona (se ve tecla a tecla en el video). */
export async function typeSlow(page: Page, locator: ReturnType<Page['locator']>, text: string, delay = 40): Promise<void> {
  await clickEl(page, locator)
  await locator.pressSequentially(text, { delay })
}

/** Punto del plano (m) → pantalla, con la transformación real del lienzo de Konva. */
export async function screenOf(page: Page, mpp: number, p: Pt): Promise<Pt> {
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

/** Píxeles de pantalla por metro del plano (para la regla). */
export async function pxPerMeter(page: Page, mpp: number): Promise<number> {
  const a = await screenOf(page, mpp, { x: 0, y: 0 })
  const b = await screenOf(page, mpp, { x: 1, y: 0 })
  return Math.hypot(b.x - a.x, b.y - a.y)
}
