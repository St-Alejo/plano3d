/**
 * Secciones de la landing, en el mismo lenguaje que el hero: fondo de noche, tinta hueso,
 * titulares en serif y un único acento dorado. Sin antetítulos, sin numeraciones ni líneas
 * finas: la jerarquía la llevan el tamaño, el espacio y los cambios de campo de color.
 */
import { ArrowRight, FileUp } from 'lucide-react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'

import { polygonArea } from '@/domain/model'
import { ACCEPT } from '@/features/capture/validateFile'
import { PlanCanvas } from './PlanCanvas'
import { EASE } from './ease'
import { CountUp, Reveal, Stagger, StaggerItem } from './reveal'
import { sampleApartment } from './sampleApartment'

const ModelStill = lazy(() => import('./ModelStill'))

/** Título de sección: el h2 grande a la izquierda y, a la derecha, la frase que lo explica. */
export function SectionHead({ id, title, lead }: { id: string; title: ReactNode; lead?: string }) {
  return (
    <Stagger className="grid gap-x-16 gap-y-6 md:grid-cols-[7fr_5fr] md:items-end" gap={0.09}>
      <StaggerItem>
        <h2 id={id} className="display text-[clamp(2.75rem,5.6vw,5.5rem)] leading-[0.95]">
          {title}
        </h2>
      </StaggerItem>
      {lead && (
        <StaggerItem>
          <p className="max-w-md text-lg leading-relaxed">{lead}</p>
        </StaggerItem>
      )}
    </Stagger>
  )
}

/* ------------------------------------------------------------------ capacidades */

/** Lo que se puede hacer con un plano, cada cosa con una captura real de la app. */
const CAPABILITIES = [
  { img: 'editor', title: 'Editor de planos', text: 'Mueve muros, puertas y medidas; el 3D se actualiza mientras lo haces.', href: '/tutoriales/editar.webm', alt: 'El editor con el plano en 2D a la izquierda y el modelo 3D a la derecha' },
  { img: 'modelo', title: 'Modelo 3D', text: 'Orbita la maqueta o camina por dentro, con puertas que se abren a tu paso.', href: '/tutoriales/recorrer.webm', alt: 'La maqueta 3D de un apartamento con sus muebles' },
  { img: 'pisos', title: 'Piso por piso', text: 'Pasa el cursor por un piso para ver su ficha y aíslalo como una maqueta.', href: '/nuevo', alt: 'Una casa de dos pisos con la planta baja aislada y cortada' },
  { img: 'obra', title: 'Modo obra', text: 'Columnetas, vigas y ladrillo según la NSR-10, Título E, con las medidas para el maestro.', href: '/nuevo', alt: 'La casa en mampostería confinada, con ladrillo y columnetas' },
  { img: 'acero', title: 'Despiece de acero', text: 'La cartilla de hierro por elemento, con kilos, diámetros y archivo CSV.', href: '/nuevo', alt: 'El esqueleto de acero de la casa y la tabla del despiece' },
  { img: 'secuencia', title: 'Secuencia de obra', text: 'La casa construyéndose etapa por etapa, de la zanja al último muro.', href: '/nuevo', alt: 'La etapa de muros de la secuencia de obra, a pantalla completa' },
] as const

/**
 * Lista grande a la izquierda y, a la derecha, la captura del elemento activo (fija mientras
 * se lee la lista). Pasar el cursor o el foco por un nombre cambia la captura. En el celular
 * cada elemento lleva su captura debajo.
 */
export function Capabilities() {
  const [active, setActive] = useState(0)
  return (
    <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
      <ul aria-label="Qué puedes hacer" className="grid gap-10 lg:gap-7">
        {CAPABILITIES.map((c, i) => {
          const external = c.href.endsWith('.webm')
          const linkClass = clsx(
            'display inline-flex min-h-11 items-center text-[clamp(2.1rem,3.4vw,3.25rem)] leading-none transition-colors duration-300 focus-visible:outline-offset-4',
            i === active ? 'text-(--l-ink)' : 'text-(--l-ink) lg:text-(--l-dim) lg:hover:text-(--l-ink)',
          )
          const props = { onMouseEnter: () => setActive(i), onFocus: () => setActive(i), className: linkClass }
          return (
            <li key={c.img}>
              <h3>
                {external ? (
                  <a href={c.href} {...props}>
                    {c.title}
                  </a>
                ) : (
                  <Link to={c.href} {...props}>
                    {c.title}
                  </Link>
                )}
              </h3>
              <p className="mt-2 max-w-md">{c.text}</p>
              <img
                src={`/landing/${c.img}.jpg`}
                alt={c.alt}
                width={1280}
                height={800}
                loading="lazy"
                decoding="async"
                className="mt-5 aspect-[16/10] w-full object-cover lg:hidden"
              />
            </li>
          )
        })}
      </ul>
      <div className="hidden lg:block">
        <div className="sticky top-28">
          <div className="relative aspect-[16/10] overflow-hidden bg-(--l-night-2)">
            {CAPABILITIES.map((c, i) => (
              <img
                key={c.img}
                src={`/landing/${c.img}.jpg`}
                alt={i === active ? c.alt : ''}
                aria-hidden={i !== active}
                width={1280}
                height={800}
                loading="lazy"
                decoding="async"
                className={clsx(
                  'absolute inset-0 size-full object-cover transition-[opacity,transform] duration-700 ease-out',
                  i === active ? 'scale-100 opacity-100' : 'scale-[1.03] opacity-0',
                )}
              />
            ))}
          </div>
          <p className="mt-4 text-(--l-dim)">{CAPABILITIES[active]!.title}: captura de la app con un plano real.</p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ antes / después */

/** Antes / después: el plano dibujado contra el modelo visto desde arriba, con el mismo encuadre. */
export function BeforeAfter() {
  const model = useMemo(() => sampleApartment(), [])
  const [split, setSplit] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const id = useId()
  const seen = useInView(box, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()

  // al verlo por primera vez el divisor hace un vaivén corto para sugerir que se puede arrastrar
  useEffect(() => {
    if (!seen || reduce) return
    const ctl = animate(50, [50, 26, 72, 50], {
      duration: 2.4,
      ease: EASE,
      times: [0, 0.3, 0.7, 1],
      delay: 0.3,
      onUpdate: (v) => setSplit(Math.round(v)),
    })
    return () => ctl.stop()
  }, [seen, reduce])

  const moveTo = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    setSplit(Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))))
  }

  return (
    <div>
      <Reveal>
        <div
          ref={box}
          className="relative aspect-[4/3] touch-none overflow-hidden bg-(--l-sheet) select-none sm:aspect-[16/9]"
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
              <ModelStill model={model} />
            </Suspense>
          </div>
          <div className="absolute inset-0 bg-(--l-sheet)" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
            <PlanCanvas model={model} className="size-full" label="Plano del apartamento" />
          </div>
          <div className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 bg-(--l-signal)" style={{ left: `${split}%` }} aria-hidden>
            <span className="absolute top-1/2 left-1/2 grid size-12 -translate-1/2 place-items-center rounded-full bg-(--l-signal) text-(--l-on-signal)">
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 5 2 10l5 5M13 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <span className={clsx('absolute top-4 left-4 bg-(--l-night) px-3 py-1.5 text-sm transition-opacity duration-300', split < 14 && 'opacity-0')}>El plano</span>
          <span className={clsx('absolute top-4 right-4 bg-(--l-night) px-3 py-1.5 text-sm transition-opacity duration-300', split > 86 && 'opacity-0')}>
            El modelo
          </span>
        </div>
      </Reveal>
      <label htmlFor={id} className="mt-5 flex items-center gap-4">
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

/* ------------------------------------------------------------------ recorrido en video */

/** El recorrido real grabado de la app, en bucle y sin sonido. */
export function WalkFilm() {
  const reduce = useReducedMotion()
  return (
    <div className="grid items-end gap-10 lg:grid-cols-[8fr_4fr] lg:gap-16">
      <Reveal>
        <video
          className="aspect-video w-full bg-(--l-night-2) object-cover"
          src="/tutoriales/recorrer.webm"
          poster="/landing/recorrido.jpg"
          autoPlay={!reduce}
          muted
          loop
          playsInline
          controls={!!reduce}
          preload="metadata"
          aria-label="Grabación de la app: se elige Recorrer, se camina por la casa y se abre una puerta"
        />
      </Reveal>
      <Stagger className="grid gap-6" gap={0.09}>
        <StaggerItem>
          <p className="text-lg leading-relaxed">
            Con el teclado, el mouse o el joystick del celular. Las puertas se abren al acercarte, las escaleras se suben y cada ambiente
            tiene su punto de vista.
          </p>
        </StaggerItem>
        <StaggerItem>
          <a href="/tutoriales/recorrer.webm" className="group inline-flex min-h-11 items-center gap-2 font-medium text-(--l-signal)">
            Ver el tutorial completo <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
          </a>
        </StaggerItem>
      </Stagger>
    </div>
  )
}

/* ------------------------------------------------------------------ cómo funciona */

const SPECS: { title: string; text: string }[] = [
  { title: 'Sube lo que tengas', text: 'Una foto con el celular, una imagen escaneada, un PDF o un DXF de AutoCAD, hasta 25 MB. Si el plano es grande, varias fotos se unen solas.' },
  { title: 'Lee el plano', text: 'Encuentra muros, puertas, ventanas, columnas, escaleras, cotas y ambientes, y marca qué medidas son exactas y cuáles hay que revisar.' },
  { title: 'Medidas reales', text: 'Los DXF y PDF vectoriales salen exactos. En fotos la escala se estima y se fija con una cota que conozcas.' },
  { title: 'Corrige a mano', text: 'Un editor 2D con imán a 1 cm, cotas sobre cada muro, historial de versiones y una lista de problemas para revisar.' },
  { title: 'Ve la obra', text: 'Cimentación, columnetas, vigas y ladrillo según la NSR-10, con la cartilla de acero y la secuencia de construcción.' },
  { title: 'Llévatelo', text: 'Exporta a GLB u OBJ y ábrelo en Blender, SketchUp o cualquier visor web.' },
]

export function Specs() {
  return (
    <Stagger as="ul" className="grid gap-x-16 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
      {SPECS.map((s) => (
        <StaggerItem as="li" key={s.title}>
          <h3 className="display text-[2.25rem] leading-none">{s.title}</h3>
          <p className="mt-4 leading-relaxed">{s.text}</p>
        </StaggerItem>
      ))}
    </Stagger>
  )
}

/* ------------------------------------------------------------------ áreas */

/** Cuadro de áreas del apartamento de muestra, medido con las funciones del dominio. */
export function AreaSchedule() {
  const model = useMemo(() => sampleApartment(), [])
  const rooms = model.levels.flatMap((lv) => lv.rooms).map((r) => ({ name: r.label, area: polygonArea(r.polygon) }))
  const total = rooms.reduce((s, r) => s + r.area, 0)
  const maxArea = Math.max(...rooms.map((r) => r.area))
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[6fr_5fr] lg:gap-20">
      <Reveal className="aspect-[4/3] bg-(--l-sheet)">
        <PlanCanvas model={model} className="size-full" label="Plano del apartamento con el área de cada ambiente" />
      </Reveal>
      <table className="w-full border-collapse text-[17px]">
        <caption className="mb-5 text-left text-(--l-dim)">Cuadro de áreas del apartamento de ejemplo</caption>
        <thead>
          <tr className="border-b border-(--l-rule) text-left text-(--l-dim)">
            <th scope="col" className="py-3 font-normal">
              Ambiente
            </th>
            <th scope="col" className="py-3 text-right font-normal">
              Área (m²)
            </th>
            <th scope="col" className="py-3 text-right font-normal">
              %
            </th>
          </tr>
        </thead>
        <Stagger as="tbody" gap={0.07}>
          {rooms.map((r) => (
            <StaggerItem as="tr" key={r.name} className="border-b border-(--l-rule)">
              <td className="py-4">
                {r.name}
                {/* barra proporcional al área: se dibuja de izquierda a derecha al entrar */}
                <span className="mt-2 block h-1 bg-(--l-night-2)" aria-hidden>
                  <motion.span
                    className="block h-full origin-left bg-(--l-signal)"
                    style={{ width: `${(r.area / maxArea) * 100}%` }}
                    variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 1, ease: EASE, delay: 0.2 } } }}
                  />
                </span>
              </td>
              <td className="py-4 text-right tabular-nums">{r.area.toFixed(2)}</td>
              <td className="py-4 text-right tabular-nums">{((r.area / total) * 100).toFixed(0)}</td>
            </StaggerItem>
          ))}
        </Stagger>
        <tfoot>
          <tr className="display text-3xl">
            <td className="pt-6">Área útil</td>
            <td className="pt-6 text-right tabular-nums">
              <CountUp value={total} decimals={2} />
            </td>
            <td className="pt-6 text-right tabular-nums">100</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ cierre */

/** Cierre en campo dorado con zona de arrastre: el archivo viaja a /nuevo en el estado de la navegación. */
export function DropCta() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const go = (file: File | undefined) => {
    if (file) void navigate('/nuevo', { state: { file } })
  }
  return (
    <div className="frame grid gap-12 lg:grid-cols-[6fr_5fr] lg:items-center lg:gap-20">
      <Stagger gap={0.09}>
        <StaggerItem>
          <h2 id="empezar" className="display text-[clamp(3rem,7vw,7rem)] leading-[0.9]">
            Tu plano, en 3D, hoy.
          </h2>
        </StaggerItem>
        <StaggerItem>
          <p className="mt-6 max-w-md text-xl leading-relaxed">Súbelo y en unos segundos tienes el modelo listo para revisar, corregir, recorrer y construir.</p>
        </StaggerItem>
        <StaggerItem>
          <Link to="/proyectos" className="group mt-6 inline-flex min-h-12 items-center gap-2 text-lg font-medium underline decoration-2 underline-offset-[6px]">
            Ver mis proyectos <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
          </Link>
        </StaggerItem>
      </Stagger>
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
          'grid place-items-center gap-4 border-2 border-dashed px-6 py-16 text-center transition-[border-color,background-color,transform] duration-300',
          over ? 'scale-[1.02] border-(--l-on-signal) bg-black/10' : 'border-(--l-on-signal)/45 hover:border-(--l-on-signal) hover:bg-black/5',
        )}
      >
        <motion.span animate={over ? { y: -6 } : { y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
          <FileUp className="size-9" aria-hidden />
        </motion.span>
        <p className="display text-4xl">Arrastra aquí tu plano</p>
        <p>JPG, PNG, WEBP, PDF o DXF, hasta 25 MB</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-2 inline-flex h-12 items-center gap-2 rounded-full bg-(--l-on-signal) px-7 font-medium text-(--l-signal) transition-transform duration-300 hover:-translate-y-0.5 active:translate-y-0"
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
    <footer className="bg-(--l-night) pt-24 pb-10">
      <div className="frame">
        <p className="display text-[clamp(4.5rem,17vw,17rem)] leading-[0.8]" aria-hidden>
          Plano 3D
        </p>
        <div className="mt-10 flex flex-col gap-3 text-(--l-dim) sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="text-(--l-ink)">Plano 3D</span>, proyecto final de Programación Orientada a Objetos
          </p>
          <p>Bogotá, 2026</p>
        </div>
      </div>
    </footer>
  )
}
