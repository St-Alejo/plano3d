/**
 * Secciones de la landing, en el mismo lenguaje que el hero: fondo de noche, tinta hueso,
 * titulares en serif y un único acento dorado. Una idea por pantalla y poco texto: la
 * jerarquía la llevan el tamaño, el espacio y las imágenes reales de la app.
 */
import { ArrowRight, FileUp } from 'lucide-react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'

import { ACCEPT } from '@/features/capture/validateFile'
import { PlanCanvas } from './PlanCanvas'
import { EASE } from './ease'
import { Reveal, Stagger, StaggerItem } from './reveal'
import { sampleApartment } from './sampleApartment'

const ModelStill = lazy(() => import('./ModelStill'))

/** Título de sección: el h2 y, si hace falta, una sola frase debajo. */
export function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <Stagger className="grid max-w-3xl gap-5" gap={0.09}>
      <StaggerItem>
        <h2 id={id} className="t-h2">
          {title}
        </h2>
      </StaggerItem>
      {lead && (
        <StaggerItem>
          <p className="t-lead max-w-xl">{lead}</p>
        </StaggerItem>
      )}
    </Stagger>
  )
}

/* ------------------------------------------------------------------ capacidades */

/** Lo que se puede hacer con un plano, cada cosa con una captura real de la app. */
const CAPABILITIES = [
  { img: 'editor', title: 'Editor de planos', text: 'Mueve muros, puertas y medidas; el 3D se actualiza mientras lo haces.', href: '/tutoriales/editar.webm', alt: 'El editor con el plano en 2D a la izquierda y el modelo 3D a la derecha' },
  { img: 'modelo', title: 'Modelo 3D', text: 'Orbita la maqueta o camínala por dentro, piso por piso.', href: '/tutoriales/recorrer.webm', alt: 'La maqueta 3D de un apartamento con sus muebles' },
  { img: 'obra', title: 'Modo obra', text: 'Ladrillo, columnetas, vigas y acero según la NSR-10, con la secuencia de construcción.', href: '/nuevo', alt: 'La casa en mampostería confinada, con ladrillo y columnetas' },
] as const

/**
 * Tres nombres a la izquierda y, a la derecha, la captura del activo (fija mientras se lee la
 * lista). Pasar el cursor o el foco por un nombre cambia la captura. En el celular cada uno
 * lleva su captura debajo.
 */
export function Capabilities() {
  const [active, setActive] = useState(0)
  return (
    <div className="grid gap-14 lg:grid-cols-[4fr_8fr] lg:gap-16">
      <ul aria-label="Qué puedes hacer" className="grid content-start gap-12 lg:gap-10">
        {CAPABILITIES.map((c, i) => {
          const external = c.href.endsWith('.webm')
          const linkClass = clsx(
            'display t-h3 inline-flex min-h-11 items-center transition-colors duration-300 focus-visible:outline-offset-4',
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
              <p className="mt-2 max-w-sm">{c.text}</p>
              <img
                src={`/landing/${c.img}.jpg`}
                alt={c.alt}
                width={1280}
                height={800}
                loading="lazy"
                decoding="async"
                className="mt-6 aspect-[16/10] w-full object-cover lg:hidden"
              />
            </li>
          )
        })}
      </ul>
      <div className="hidden lg:block">
        <div className="sticky top-28 aspect-[16/10] overflow-hidden bg-(--l-night-2)">
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
                i === active ? 'scale-100 opacity-100' : 'scale-[1.02] opacity-0',
              )}
            />
          ))}
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
    const ctl = animate(50, [50, 30, 68, 50], {
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
          <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-(--l-signal)" style={{ left: `${split}%` }} aria-hidden>
            <span className="absolute top-1/2 left-1/2 grid size-11 -translate-1/2 place-items-center rounded-full bg-(--l-signal) text-(--l-on-signal)">
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 5 2 10l5 5M13 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <span className={clsx('t-small absolute top-4 left-4 bg-(--l-night) px-3 py-1.5 transition-opacity duration-300', split < 14 && 'opacity-0')}>El plano</span>
          <span className={clsx('t-small absolute top-4 right-4 bg-(--l-night) px-3 py-1.5 transition-opacity duration-300', split > 86 && 'opacity-0')}>
            El modelo
          </span>
        </div>
      </Reveal>
      <label htmlFor={id} className="mt-4 flex items-center gap-4">
        <span className="sr-only">Comparar el plano con el modelo</span>
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

/* ------------------------------------------------------------------ cierre */

/** Cierre: la invitación y la zona para soltar el plano; el archivo viaja a /nuevo en el estado de la navegación. */
export function Closing() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const go = (file: File | undefined) => {
    if (file) void navigate('/nuevo', { state: { file } })
  }
  return (
    <div className="frame">
      <div className="grid gap-12 lg:grid-cols-[6fr_5fr] lg:items-center lg:gap-20">
        <Stagger gap={0.09}>
          <StaggerItem>
            <h2 id="empezar" className="t-h2">
              Tu plano, en 3D, hoy.
            </h2>
          </StaggerItem>
          <StaggerItem>
            <p className="t-lead mt-5 max-w-md">Súbelo y en segundos tienes el modelo para revisar, recorrer y construir.</p>
          </StaggerItem>
          <StaggerItem>
            <Link to="/proyectos" className="group mt-5 inline-flex min-h-11 items-center gap-2 font-medium underline decoration-(--l-signal) decoration-2 underline-offset-[6px]">
              Ver mis proyectos <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
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
            'grid place-items-center gap-4 px-6 py-16 text-center transition-[background-color,transform] duration-300',
            over ? 'scale-[1.01] bg-(--l-signal)/15' : 'bg-(--l-night-2) hover:bg-white/8',
          )}
        >
          <motion.span animate={over ? { y: -6 } : { y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
            <FileUp className="size-8 text-(--l-signal)" aria-hidden />
          </motion.span>
          <p className="display t-h3">Arrastra aquí tu plano</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="inline-flex h-12 items-center rounded-full bg-(--l-signal) px-7 font-medium text-(--l-on-signal) transition-[transform,background-color] duration-300 hover:-translate-y-0.5 hover:bg-(--l-signal-hi) active:translate-y-0"
          >
            Elegir archivo
          </button>
          <p className="t-small text-(--l-dim)">JPG, PNG, WEBP, PDF o DXF, hasta 25 MB</p>
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => go(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  )
}

const FOOTER_LINKS = [
  { to: '/nuevo', label: 'Convertir un plano' },
  { to: '/proyectos', label: 'Mis proyectos' },
  { to: '/tutoriales/recorrer.webm', label: 'Tutorial: recorrer en 3D', file: true },
] as const

/** Cierre de la página: el nombre vuelve a todo el ancho y, debajo, enlaces y créditos. */
export function Footer() {
  return (
    <footer className="frame mt-20 grid gap-10 pt-16 pb-10 sm:mt-32">
      <Reveal>
        <p className="display text-[clamp(4.5rem,19vw,19rem)] leading-[0.8] tracking-[-0.04em]" aria-hidden>
          Plano 3D
        </p>
      </Reveal>
      <div className="flex flex-col gap-6 t-small text-(--l-dim) md:flex-row md:items-center md:justify-between">
        <nav aria-label="Pie de página" className="flex flex-wrap gap-x-6">
          {FOOTER_LINKS.map((l) =>
            'file' in l ? (
              <a key={l.to} href={l.to} className="inline-flex min-h-11 items-center text-(--l-ink) transition-colors duration-300 hover:text-(--l-signal)">
                {l.label}
              </a>
            ) : (
              <Link key={l.to} to={l.to} className="inline-flex min-h-11 items-center text-(--l-ink) transition-colors duration-300 hover:text-(--l-signal)">
                {l.label}
              </Link>
            ),
          )}
        </nav>
        <p>Proyecto final de Programación Orientada a Objetos · Bogotá, 2026</p>
      </div>
    </footer>
  )
}
