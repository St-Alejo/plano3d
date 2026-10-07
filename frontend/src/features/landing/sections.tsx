/**
 * Secciones de la landing. Texto directo, tablas y listas sencillas; el único
 * color de acento es el verde de `--l-signal`.
 */
import { ArrowRight, FileUp } from 'lucide-react'
import { useMotionValue } from 'motion/react'
import { lazy, Suspense, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'

import { polygonArea } from '@/domain/model'
import { ACCEPT } from '@/features/capture/validateFile'
import { PlanCanvas } from './PlanCanvas'
import { sampleApartment } from './sampleApartment'

const HeroScene = lazy(() => import('./HeroScene'))

export function SectionHead({ id, kicker, title, lead }: { id: string; kicker: string; title: string; lead?: string }) {
  return (
    <header className="grid gap-x-16 gap-y-4 md:grid-cols-[1fr_1fr] md:items-end">
      <div>
        <p className="text-sm font-semibold text-(--l-signal-ink)">{kicker}</p>
        <h2 id={id} className="mt-3 text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] font-semibold">
          {title}
        </h2>
      </div>
      {lead && <p className="max-w-md text-lg leading-relaxed text-(--l-graphite)">{lead}</p>}
    </header>
  )
}

const tag = 'absolute top-3 rounded-full bg-(--l-paper)/90 px-3 py-1 text-xs font-medium text-(--l-graphite) shadow-sm'

/** Antes / después: el plano dibujado contra el modelo 3D, con un divisor arrastrable (y accesible). */
export function BeforeAfter() {
  const model = useMemo(() => sampleApartment(), [])
  const [split, setSplit] = useState(50)
  // pose isométrica fija: la misma escena del hero detenida en el paso 4
  const pose = useMotionValue(0.82)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const id = useId()

  const moveTo = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    setSplit(Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))))
  }

  return (
    <div>
      <div
        ref={box}
        className="relative aspect-[4/3] touch-none overflow-hidden rounded-2xl bg-(--l-paper-2) ring-1 ring-(--l-hair) select-none sm:aspect-[16/9]"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          moveTo(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      >
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <HeroScene model={model} progress={pose} />
          </Suspense>
        </div>
        <div className="absolute inset-0 bg-(--l-paper-2)" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
          <PlanCanvas model={model} className="size-full" label="Plano del apartamento" />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_var(--l-hair)]" style={{ left: `${split}%` }} aria-hidden>
          <span className="absolute top-1/2 left-1/2 grid size-10 -translate-1/2 place-items-center rounded-full bg-white text-(--l-ink) shadow-md">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M7 5 2 10l5 5M13 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <span className={clsx(tag, 'left-3')}>Plano</span>
        <span className={clsx(tag, 'right-3')}>Modelo 3D</span>
      </div>
      <label htmlFor={id} className="mt-4 flex items-center gap-4 text-sm text-(--l-graphite)">
        <span className="shrink-0">Comparar</span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="h-11 w-full accent-(--l-signal)"
          aria-valuetext={`${split} % plano, ${100 - split} % modelo`}
        />
      </label>
    </div>
  )
}

const SPECS: { title: string; text: string }[] = [
  { title: 'Sube lo que tengas', text: 'Una foto con el celular, una imagen escaneada, un PDF o un DXF de AutoCAD. Si el plano es grande, varias fotos se unen solas.' },
  { title: 'Lee el plano', text: 'Encuentra muros, puertas, ventanas, columnas, escaleras, cotas y ambientes, y marca qué medidas son exactas y cuáles hay que revisar.' },
  { title: 'Medidas reales', text: 'Los DXF y PDF vectoriales salen exactos. En fotos la escala se estima y se fija con una cota que conozcas.' },
  { title: 'Corrige a mano', text: 'Un editor 2D con imán, cotas sobre cada muro, historial de versiones y una lista de problemas para revisar.' },
  { title: 'Recórrelo', text: 'Gira alrededor del modelo, vuela a cada ambiente o camina por dentro con teclado, mouse o el joystick del celular.' },
  { title: 'Llévatelo', text: 'Exporta a GLB y ábrelo en Blender, SketchUp o cualquier visor web.' },
]

export function Specs() {
  return (
    <ol className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {SPECS.map((s, i) => (
        <li key={s.title} className="border-t border-(--l-hair-strong) pt-5">
          <p className="text-sm text-(--l-graphite) tabular-nums">{i + 1}</p>
          <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
          <p className="mt-2 leading-relaxed text-(--l-graphite)">{s.text}</p>
        </li>
      ))}
    </ol>
  )
}

const CALLOUTS = [
  { n: 1, t: 'Herramientas', d: 'Seleccionar, muro, puerta, ventana, medir y calibrar, cada una con su atajo de teclado.' },
  { n: 2, t: 'Plano en 2D', d: 'La imagen original debajo y los muros encima, con imán a la rejilla, a los extremos y a 90°.' },
  { n: 3, t: '3D en vivo', d: 'Cada cambio se ve al instante. Haz clic en un muro del 3D y queda seleccionado en el plano.' },
  { n: 4, t: 'Propiedades', d: 'Largo, ángulo, grosor y altura exactos; ancho y antepecho de cada puerta o ventana.' },
  { n: 5, t: 'Revisión', d: 'Muros sueltos o duplicados y cotas en conflicto, con un clic para ir a cada uno.' },
  { n: 6, t: 'Historial', d: 'Deshacer sin límite y versiones guardadas que puedes restaurar.' },
]

/** Esquema simplificado del editor con sus seis zonas numeradas. */
export function EditorDiagram() {
  const bubble = (n: number, x: number, y: number) => (
    <g key={n}>
      <circle cx={x} cy={y} r="13" fill="var(--l-signal)" />
      <text x={x} y={y + 4.5} textAnchor="middle" fontFamily="Hanken Grotesk, sans-serif" fontWeight="600" fontSize="13" fill="#fff">
        {n}
      </text>
    </g>
  )
  return (
    <div className="grid items-start gap-12 lg:grid-cols-[7fr_5fr]">
      <div className="rounded-2xl bg-(--l-paper-2) p-4 sm:p-8">
        <svg viewBox="0 0 640 420" className="w-full" role="img" aria-label="Esquema del editor con sus seis zonas numeradas">
          <rect x="20" y="20" width="600" height="380" rx="14" fill="var(--l-paper)" stroke="var(--l-hair-strong)" />
          <g fill="none" stroke="var(--l-hair-strong)">
            <line x1="20" y1="62" x2="620" y2="62" />
            <line x1="240" y1="62" x2="240" y2="400" />
            <line x1="460" y1="62" x2="460" y2="400" />
          </g>
          {/* barra de herramientas */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={40 + i * 26} y="32" width="18" height="18" rx="5" fill={i === 0 ? 'var(--l-signal)' : 'var(--l-paper-2)'} />
          ))}
          {/* plano en el lienzo 2D */}
          <g fill="none" stroke="var(--l-ink)" strokeLinecap="square">
            <path d="M62 104 H212 V350 H62 Z" strokeWidth="6" />
            <path d="M142 104 V200 H212" strokeWidth="3.5" />
            <path d="M62 256 H112" strokeWidth="3.5" />
          </g>
          <path d="M62 104 H212" stroke="var(--l-signal)" strokeWidth="6" />
          {/* maqueta isométrica */}
          <g stroke="var(--l-ink)" strokeWidth="1" strokeLinejoin="round">
            <path d="M285 270 L350 235 L415 270 L350 305 Z" fill="var(--l-paper-2)" />
            <path d="M285 270 V205 L350 170 V235 Z" fill="#fff" />
            <path d="M350 170 L415 205 V270 L350 235 Z" fill="var(--l-signal-soft)" />
          </g>
          {/* propiedades */}
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x="480" y={94 + i * 34} width="44" height="6" rx="3" fill="var(--l-hair-strong)" />
              <rect x="532" y={88 + i * 34} width="68" height="18" rx="5" fill="var(--l-paper-2)" />
            </g>
          ))}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx="486" cy={260 + i * 26} r="5" fill={i === 1 ? 'var(--l-signal)' : 'var(--l-hair-strong)'} />
              <rect x="498" y={257 + i * 26} width={88 - i * 14} height="6" rx="3" fill="var(--l-hair-strong)" />
            </g>
          ))}
          {bubble(1, 222, 41)}
          {bubble(2, 137, 228)}
          {bubble(3, 350, 120)}
          {bubble(4, 600, 158)}
          {bubble(5, 600, 286)}
          {bubble(6, 600, 41)}
        </svg>
      </div>
      <ol className="grid content-start gap-5">
        {CALLOUTS.map((c) => (
          <li key={c.n} className="grid grid-cols-[1.75rem_1fr] gap-3">
            <span className="grid size-7 place-items-center rounded-full bg-(--l-signal-soft) text-sm font-semibold text-(--l-signal-ink)">{c.n}</span>
            <div>
              <p className="font-semibold">{c.t}</p>
              <p className="mt-0.5 leading-relaxed text-(--l-graphite)">{c.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Cuadro de áreas del apartamento de muestra, medido con las funciones del dominio. */
export function AreaSchedule() {
  const model = useMemo(() => sampleApartment(), [])
  const rooms = model.levels.flatMap((lv) => lv.rooms).map((r) => ({ name: r.label, area: polygonArea(r.polygon) }))
  const total = rooms.reduce((s, r) => s + r.area, 0)
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[6fr_5fr]">
      <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-(--l-paper-2)">
        <PlanCanvas model={model} className="size-full" label="Plano del apartamento con el área de cada ambiente" />
      </div>
      <table className="w-full border-collapse text-[15px]">
        <caption className="mb-4 text-left font-semibold">Cuadro de áreas del apartamento de ejemplo</caption>
        <thead>
          <tr className="border-b border-(--l-hair-strong) text-left text-sm text-(--l-graphite)">
            <th scope="col" className="py-2 font-medium">
              Ambiente
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Área (m²)
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.name} className="border-b border-(--l-hair)">
              <td className="py-3.5">{r.name}</td>
              <td className="py-3.5 text-right tabular-nums">{r.area.toFixed(2)}</td>
              <td className="py-3.5 text-right text-(--l-graphite) tabular-nums">{((r.area / total) * 100).toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="pt-4">Área útil</td>
            <td className="pt-4 text-right tabular-nums">{total.toFixed(2)}</td>
            <td className="pt-4 text-right tabular-nums">100</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Cierre con zona de arrastre: el archivo viaja a /nuevo en el estado de la navegación. */
export function DropCta() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const go = (file: File | undefined) => {
    if (file) void navigate('/nuevo', { state: { file } })
  }
  return (
    <div className="grid gap-10 rounded-3xl bg-(--l-deep) p-6 text-white sm:p-12 lg:grid-cols-[5fr_6fr] lg:items-center lg:p-16">
      <div>
        <h2 id="empezar" className="text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] font-semibold">
          Tu plano, en 3D, hoy.
        </h2>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-white/75">
          Súbelo y en unos segundos tienes el modelo listo para revisar, corregir y recorrer.
        </p>
        <Link to="/proyectos" className="mt-6 inline-flex min-h-11 items-center gap-2 font-medium text-white/90 underline-offset-4 hover:underline">
          Ver mis proyectos <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          go(e.dataTransfer.files[0])
        }}
        className={clsx(
          'grid place-items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors',
          over ? 'border-white bg-white/10' : 'border-white/30',
        )}
      >
        <FileUp className="size-8 text-white/70" aria-hidden />
        <p className="text-lg font-medium">Arrastra aquí tu plano</p>
        <p className="text-sm text-white/65">JPG, PNG, WEBP, PDF o DXF · hasta 25 MB</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-2 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 font-medium text-(--l-deep) hover:bg-(--l-signal-soft)"
        >
          Elegir archivo
        </button>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => go(e.target.files?.[0])} />
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-(--l-hair)">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-sm text-(--l-graphite) sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-semibold text-(--l-ink)">Plano 3D</span> · Proyecto final de Programación Orientada a Objetos
        </p>
        <p>Bogotá, 2026</p>
      </div>
    </footer>
  )
}
