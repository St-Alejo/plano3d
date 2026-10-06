/**
 * Secciones de la lámina: cada una se abre con su marca de corte (A–A′, B–B′…)
 * como en un juego de planos. Sin tarjetas: tablas, líneas finas y anotaciones.
 */
import { ArrowRight, FileUp } from 'lucide-react'
import { useMotionValue } from 'motion/react'
import { lazy, Suspense, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'

import { polygonArea } from '@/domain/model'
import { ACCEPT } from '@/features/capture/validateFile'
import { PlanCanvas } from './PlanCanvas'
import { sampleApartment } from './sampleApartment'

const HeroScene = lazy(() => import('./HeroScene'))

export function SectionHead({ cut, title, kicker, id }: { cut: string; title: ReactNode; kicker: string; id: string }) {
  return (
    <header className="grid gap-4 border-t border-(--l-ink) pt-5 md:grid-cols-[180px_1fr]">
      <div className="flex items-center gap-3 font-mono text-xs text-(--l-signal-ink)" aria-hidden>
        <span className="grid size-9 place-items-center rounded-full border border-(--l-signal) text-sm">{cut}</span>
        <span className="h-px w-8 bg-(--l-signal)" />
        <span>{cut}′</span>
      </div>
      <div>
        <p className="font-mono text-xs tracking-[0.18em] text-(--l-graphite) uppercase">{kicker}</p>
        <h2 id={id} className="serif mt-2 text-[clamp(2.2rem,4.6vw,4.4rem)] leading-[0.95]">
          {title}
        </h2>
      </div>
    </header>
  )
}

/** Antes / después: la lámina en tinta contra el modelo 3D, con un divisor arrastrable (y accesible). */
export function BeforeAfter() {
  const model = useMemo(() => sampleApartment(), [])
  const [split, setSplit] = useState(50)
  // pose isométrica fija: la misma escena del hero detenida en la figura 04
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
        className="relative aspect-[4/3] touch-none overflow-hidden border border-(--l-hair-strong) select-none sm:aspect-[16/9]"
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
        <div className="absolute inset-0 bg-(--l-paper)" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
          <PlanCanvas model={model} className="size-full" label="Plano del apartamento en tinta" />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-(--l-signal)" style={{ left: `${split}%` }} aria-hidden>
          <span className="absolute top-1/2 left-1/2 grid size-10 -translate-1/2 place-items-center rounded-full border border-(--l-signal) bg-(--l-paper) font-mono text-[10px] text-(--l-signal-ink)">
            ⟷
          </span>
        </div>
        <span className="absolute top-3 left-3 bg-(--l-paper) px-1.5 font-mono text-[11px] text-(--l-graphite)">ANTES · PLANO</span>
        <span className="absolute top-3 right-3 bg-(--l-paper) px-1.5 font-mono text-[11px] text-(--l-graphite)">DESPUÉS · MODELO 3D</span>
      </div>
      <label htmlFor={id} className="mt-3 flex items-center gap-4 font-mono text-xs text-(--l-graphite)">
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

const SPECS: { k: string; v: ReactNode; note: string }[] = [
  { k: 'Entrada', v: 'Foto (JPG · PNG · WEBP), PDF o DXF', note: 'hasta 25 MB; varias fotos de un pliego grande se unen solas' },
  { k: 'Lectura', v: 'Muros, puertas, ventanas, columnas, escaleras, cotas y ambientes', note: 'cada medida queda marcada: exacta, por verificar o en conflicto' },
  { k: 'Precisión', v: 'DXF y PDF vectorial: exactos al milímetro', note: 'en fotos la escala se estima y se fija con una cota conocida' },
  { k: 'Corrección', v: 'Editor 2D con imán, cotas, historial y revisión del modelo', note: 'el 3D se actualiza mientras editas' },
  { k: 'Recorrido', v: 'Órbita, vuelo a cada ambiente y caminata en primera persona', note: 'teclado, mouse o joystick táctil' },
  { k: 'Salida', v: 'GLB para Blender, SketchUp o la web', note: 'más el plano original superpuesto para comparar' },
]

export function SpecSheet() {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Especificaciones de Plano 3D</caption>
      <tbody>
        {SPECS.map((s, i) => (
          <tr key={s.k} className="border-b border-(--l-hair) align-top">
            <th scope="row" className="w-12 py-5 pr-4 font-mono text-xs font-normal text-(--l-signal-ink)">
              {String(i + 1).padStart(2, '0')}
            </th>
            <th scope="row" className="w-36 py-5 pr-6 font-mono text-xs font-medium tracking-[0.14em] uppercase">
              {s.k}
            </th>
            <td className="py-5 pr-6 text-lg leading-snug md:text-xl">{s.v}</td>
            <td className="hidden max-w-xs py-5 text-sm text-(--l-graphite) md:table-cell">{s.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const CALLOUTS = [
  { n: 1, t: 'Herramientas', d: 'Seleccionar, dibujar muro, puerta, ventana, medir y calibrar; cada una con su atajo.' },
  { n: 2, t: 'Lienzo 2D', d: 'El plano original debajo, los muros encima. Imán a rejilla, a extremos y a 90°.' },
  { n: 3, t: 'Vista 3D en vivo', d: 'Cada cambio se ve al instante; un clic en un muro lo selecciona en el plano.' },
  { n: 4, t: 'Propiedades', d: 'Largo, ángulo, grosor y altura exactos; ancho y antepecho de cada vano.' },
  { n: 5, t: 'Revisión', d: 'Muros sueltos, duplicados o cotas en conflicto, listados y con un clic para ir a ellos.' },
  { n: 6, t: 'Historial', d: 'Deshacer ilimitado y versiones guardadas que puedes restaurar.' },
]

/** Esquema del editor dibujado como un detalle constructivo, con llamadas numeradas. */
export function EditorDiagram() {
  const bubble = (n: number, x: number, y: number, lx: number, ly: number) => (
    <g key={n}>
      <line x1={x} y1={y} x2={lx} y2={ly} stroke="var(--l-signal)" strokeWidth="1" />
      <circle cx={lx} cy={ly} r="3" fill="var(--l-signal)" />
      <circle cx={x} cy={y} r="13" fill="var(--l-paper)" stroke="var(--l-signal)" />
      <text x={x} y={y + 4} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="12" fill="var(--l-signal-ink)">
        {n}
      </text>
    </g>
  )
  return (
    <div className="grid gap-10 lg:grid-cols-[7fr_5fr]">
      <svg viewBox="0 0 640 420" className="w-full" role="img" aria-label="Esquema del editor con sus seis zonas numeradas">
        <g fill="none" stroke="var(--l-ink)" strokeWidth="1.2">
          <rect x="40" y="40" width="560" height="340" />
          <line x1="40" y1="74" x2="600" y2="74" />
          <line x1="250" y1="74" x2="250" y2="380" />
          <line x1="460" y1="74" x2="460" y2="380" />
        </g>
        {/* barra de herramientas */}
        <g fill="var(--l-ink)">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={52 + i * 22} y="50" width="14" height="14" rx="2" opacity={i === 0 ? 1 : 0.35} />
          ))}
        </g>
        {/* plano en el lienzo 2D */}
        <g fill="none" stroke="var(--l-ink)" strokeWidth="5">
          <path d="M70 110 H220 V330 H70 Z" />
          <path d="M150 110 V200 H220" strokeWidth="3" />
          <path d="M70 250 H120" strokeWidth="3" />
        </g>
        <path d="M70 110 H220" stroke="var(--l-signal)" strokeWidth="5" />
        {/* maqueta isométrica */}
        <g fill="var(--l-paper-2)" stroke="var(--l-ink)" strokeWidth="1">
          <path d="M290 260 L355 225 L420 260 L355 295 Z" />
          <path d="M290 260 V200 L355 165 V225 Z" fill="var(--l-paper)" />
          <path d="M355 165 L420 200 V260 L355 225 Z" />
        </g>
        {/* propiedades */}
        <g fill="var(--l-ink)" opacity="0.55">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="476" y={100 + i * 26} width={i % 2 ? 80 : 110} height="6" />
          ))}
        </g>
        <g fill="var(--l-signal)" opacity="0.8">
          {[0, 1, 2].map((i) => (
            <rect key={i} x="476" y={232 + i * 22} width="8" height="8" />
          ))}
        </g>
        <g fill="var(--l-ink)" opacity="0.35">
          {[0, 1, 2].map((i) => (
            <rect key={i} x="492" y={233 + i * 22} width={70 - i * 10} height="6" />
          ))}
        </g>
        {bubble(1, 60, 18, 70, 56)}
        {bubble(2, 22, 200, 70, 200)}
        {bubble(3, 355, 120, 355, 168)}
        {bubble(4, 620, 110, 590, 110)}
        {bubble(5, 620, 245, 568, 240)}
        {bubble(6, 520, 18, 520, 56)}
      </svg>
      <ol className="grid content-start gap-4">
        {CALLOUTS.map((c) => (
          <li key={c.n} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-(--l-hair) pb-4">
            <span className="grid size-7 place-items-center rounded-full border border-(--l-signal) font-mono text-xs text-(--l-signal-ink)">
              {c.n}
            </span>
            <div>
              <p className="font-medium">{c.t}</p>
              <p className="text-sm text-(--l-graphite)">{c.d}</p>
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
    <div className="grid items-start gap-10 lg:grid-cols-[6fr_5fr]">
      <div className="aspect-[4/3] border border-(--l-hair-strong)">
        <PlanCanvas model={model} className="size-full" label="Plano del apartamento con el área de cada ambiente" />
      </div>
      <table className="w-full border-collapse font-mono text-sm">
        <caption className="mb-3 text-left font-mono text-xs tracking-[0.14em] text-(--l-graphite) uppercase">
          Cuadro de áreas · planta tipo
        </caption>
        <thead>
          <tr className="border-b border-(--l-ink) text-left text-xs text-(--l-graphite)">
            <th scope="col" className="py-2 font-normal">
              Ambiente
            </th>
            <th scope="col" className="py-2 text-right font-normal">
              Área (m²)
            </th>
            <th scope="col" className="py-2 text-right font-normal">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.name} className="border-b border-(--l-hair)">
              <td className="py-3">{r.name}</td>
              <td className="py-3 text-right tabular-nums">{r.area.toFixed(2)}</td>
              <td className="py-3 text-right text-(--l-graphite) tabular-nums">{((r.area / total) * 100).toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-(--l-ink) font-medium">
            <td className="py-3">Área útil</td>
            <td className="py-3 text-right tabular-nums">{total.toFixed(2)}</td>
            <td className="py-3 text-right tabular-nums">100</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Zona de arrastre: el archivo viaja a /nuevo en el estado de la navegación. */
export function DropCta() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const go = (file: File | undefined) => {
    if (file) void navigate('/nuevo', { state: { file } })
  }
  return (
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
        'relative grid place-items-center gap-6 border border-dashed px-6 py-16 text-center transition-colors',
        over ? 'border-(--l-signal) bg-(--l-paper-2)' : 'border-(--l-hair-strong)',
      )}
    >
      <p className="serif text-[clamp(2.4rem,6vw,5.6rem)] leading-[0.95]">
        Suelta aquí tu plano.
      </p>
      <p className="max-w-md text-(--l-graphite)">
        JPG, PNG, WEBP, PDF o DXF. En segundos tienes el modelo para revisar, corregir y recorrer.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex h-12 items-center gap-2 bg-(--l-ink) px-6 font-medium text-(--l-paper) hover:bg-(--l-signal-ink)"
        >
          <FileUp className="size-4" aria-hidden />
          Elegir archivo
        </button>
        <Link
          to="/proyectos"
          className="inline-flex h-12 items-center gap-2 border-b border-(--l-ink) px-1 font-medium hover:text-(--l-signal-ink)"
        >
          Ver mis proyectos <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => go(e.target.files?.[0])} />
    </div>
  )
}

export function TitleBlock() {
  const cells: [string, string][] = [
    ['Proyecto', 'Plano 3D'],
    ['Contenido', 'Del plano al modelo navegable'],
    ['Curso', 'Programación orientada a objetos'],
    ['Lugar', 'Bogotá, Colombia'],
    ['Escala', '1:50'],
    ['Lámina', 'A-01'],
  ]
  return (
    <footer className="border-t-2 border-(--l-ink)">
      <dl className="mx-auto grid max-w-[1400px] grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map(([k, v]) => (
          <div key={k} className="border-r border-b border-(--l-hair) px-4 py-4 sm:px-8 lg:px-5">
            <dt className="font-mono text-[11px] tracking-[0.14em] text-(--l-graphite) uppercase">{k}</dt>
            <dd className="mt-1 text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </footer>
  )
}
