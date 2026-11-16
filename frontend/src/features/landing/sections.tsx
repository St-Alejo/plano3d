/**
 * Secciones de la landing en la marca "Obra limpia": hueso y grafito, titulares en Fraunces,
 * un solo acento ladrillo y una cota numerada sobre cada título. Una idea por pantalla: la
 * jerarquía la llevan el tamaño, el espacio, las fotos de la obra y las capturas reales.
 */
import { ArrowRight, ArrowUpRight, FileUp } from 'lucide-react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'

import { Mark } from '@/components/AppShell'
import { Photo } from '@/components/Photo'
import { ACCEPT } from '@/features/capture/validateFile'
import { PlanCanvas } from './PlanCanvas'
import { EASE } from './ease'
import { DimLine, Parallax, ZoomIn } from './motion'
import { Reveal, Stagger, StaggerItem } from './reveal'
import { sampleApartment } from './sampleApartment'

const ModelStill = lazy(() => import('./ModelStill'))

/** Título de sección: la cota numerada, el h2 y, si hace falta, una sola frase debajo. */
export function SectionHead({ id, index, label, title, lead, className }: { id: string; index: number; label: string; title: string; lead?: string; className?: string }) {
  return (
    <Stagger className={clsx('grid max-w-3xl gap-6', className)} gap={0.09}>
      <StaggerItem>
        <DimLine index={index} label={label} />
      </StaggerItem>
      <StaggerItem>
        <h2 id={id} className="t-h2">
          {title}
        </h2>
      </StaggerItem>
      {lead && (
        <StaggerItem>
          <p className="t-lead max-w-xl text-(--l-dim)">{lead}</p>
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
 * lista). Pasar el cursor o el foco por un nombre cambia la captura con un fundido. En el
 * celular cada uno lleva su captura debajo.
 */
export function Capabilities() {
  const [active, setActive] = useState(0)
  return (
    <div className="grid gap-14 lg:grid-cols-[5fr_7fr] lg:gap-20">
      <ul aria-label="Qué puedes hacer" className="grid content-start border-t border-(--l-rule)">
        {CAPABILITIES.map((c, i) => {
          const external = c.href.endsWith('.webm')
          const linkClass = clsx(
            'display t-h3 group inline-flex min-h-11 items-center gap-3 transition-colors duration-300 focus-visible:outline-offset-4',
            i === active ? 'text-(--l-fg)' : 'text-(--l-fg) lg:text-(--l-dim) lg:hover:text-(--l-fg)',
          )
          const props = { onMouseEnter: () => setActive(i), onFocus: () => setActive(i), className: linkClass }
          const label = (
            <>
              {c.title}
              <ArrowUpRight className={clsx('size-5 transition-[transform,opacity] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5', i === active ? 'opacity-100' : 'opacity-40')} aria-hidden />
            </>
          )
          return (
            <li key={c.img} className="relative border-b border-(--l-rule) py-8">
              <span aria-hidden className={clsx('absolute top-[-1px] left-0 h-px bg-(--l-accent) transition-[width] duration-700 ease-out', i === active ? 'w-full' : 'w-0')} />
              <p className="t-label mb-3 text-(--l-text-accent)">{String(i + 1).padStart(2, '0')}</p>
              <h3>
                {external ? (
                  <a href={c.href} {...props}>
                    {label}
                  </a>
                ) : (
                  <Link to={c.href} {...props}>
                    {label}
                  </Link>
                )}
              </h3>
              <p className="mt-2 max-w-sm text-(--l-dim)">{c.text}</p>
              <img
                src={`/landing/${c.img}.jpg`}
                alt={c.alt}
                width={1280}
                height={800}
                loading="lazy"
                decoding="async"
                className="mt-6 aspect-[16/10] w-full rounded-lg object-cover lg:hidden"
              />
            </li>
          )
        })}
      </ul>
      <div className="hidden lg:block">
        <div className="sticky top-28 aspect-[16/10] overflow-hidden rounded-xl bg-(--l-card) shadow-[0_40px_80px_-40px_rgb(0_0_0/0.6)] ring-1 ring-(--l-rule)">
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
                i === active ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Banda oscura: la sala de la casa al lado del título y, debajo, las capacidades. */
export function CapabilitiesSection() {
  return (
    <section aria-labelledby="que-puedes-hacer" className="l-dark l-grain py-16 sm:py-24">
      <div className="frame grid gap-20">
        <div className="grid items-end gap-12 lg:grid-cols-[7fr_5fr]">
          <SectionHead
            id="que-puedes-hacer"
            index={2}
            label="Capacidades"
            title="Todo lo que sale de un plano."
            lead="El mismo modelo se edita, se recorre y se construye: cada vista lee los mismos muros."
          />
          <Parallax distance={40} className="hidden aspect-[4/5] max-h-[34rem] overflow-hidden rounded-xl lg:block">
            <Photo name="interior-sala" sizes="(min-width: 1024px) 34vw, 0px" className="size-full scale-110 object-cover" />
          </Parallax>
        </div>
        <Capabilities />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ antes / después */

/** Antes / después: el plano dibujado contra el modelo visto desde arriba, con el mismo encuadre. */
function Comparator() {
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
          className="relative aspect-[4/3] cursor-ew-resize touch-none overflow-hidden rounded-xl bg-(--l-sheet) shadow-[0_40px_80px_-48px_rgb(60_40_25/0.55)] ring-1 ring-(--l-rule) select-none sm:aspect-[16/9]"
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
          <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-(--l-accent)" style={{ left: `${split}%` }} aria-hidden>
            <span className="absolute top-1/2 left-1/2 grid size-12 -translate-1/2 place-items-center rounded-full bg-(--l-accent) text-(--l-on-accent) shadow-lg">
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 5 2 10l5 5M13 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <span className={clsx('t-label absolute top-4 left-4 rounded-full bg-(--l-fg) px-3 py-1.5 text-(--l-bg) transition-opacity duration-300', split < 14 && 'opacity-0')}>El plano</span>
          <span className={clsx('t-label absolute top-4 right-4 rounded-full bg-(--l-fg) px-3 py-1.5 text-(--l-bg) transition-opacity duration-300', split > 86 && 'opacity-0')}>
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
          className="h-11 w-full accent-(--l-accent)"
          aria-valuetext={`${split} % plano, ${100 - split} % modelo`}
        />
      </label>
    </div>
  )
}

export function BeforeAfter() {
  return (
    <section aria-labelledby="antes-despues" className="frame grid gap-14 py-16 sm:py-24">
      <SectionHead id="antes-despues" index={4} label="Antes y después" title="Del papel al modelo." lead="Arrastra el divisor: el mismo apartamento, en la misma escala." />
      <Comparator />
    </section>
  )
}

/* ------------------------------------------------------------------ cierre */

/**
 * Cierre: la calle con la casa terminada a todo el ancho (se acerca al entrar), la invitación
 * y la zona para soltar el plano; el archivo viaja a /nuevo en el estado de la navegación.
 */
export function Closing() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const go = (file: File | undefined) => {
    if (file) void navigate('/nuevo', { state: { file } })
  }
  return (
    <section aria-labelledby="empezar" className="l-dark relative overflow-hidden">
      <ZoomIn className="absolute inset-0" from={1.2}>
        <Photo name="cierre-calle" decorative sizes="100vw" className="size-full object-cover" />
      </ZoomIn>
      <div aria-hidden className="absolute inset-0 bg-linear-to-r from-black/85 via-black/60 to-black/25" />
      <div className="frame relative grid min-h-[44rem] items-center gap-12 py-16 sm:py-24 lg:grid-cols-[6fr_5fr] lg:gap-20">
        <Stagger gap={0.09}>
          <StaggerItem>
            <DimLine index={6} label="Empezar" />
          </StaggerItem>
          <StaggerItem>
            <h2 id="empezar" className="t-h2 mt-6">
              Tu plano, en 3D, hoy.
            </h2>
          </StaggerItem>
          <StaggerItem>
            <p className="t-lead mt-6 max-w-md text-(--l-dim)">Súbelo y en segundos tienes el modelo para revisar, recorrer y construir.</p>
          </StaggerItem>
          <StaggerItem>
            <Link to="/proyectos" className="group mt-6 inline-flex min-h-11 items-center gap-2 font-medium">
              <span className="l-link">Ver mis proyectos</span> <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
            </Link>
            <Link to="/escritorio" className="group mt-2 flex min-h-11 items-center gap-2 font-medium text-(--l-dim) hover:text-(--l-fg)">
              <span className="l-link">Descargar la app para Windows</span>
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
            'grid place-items-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center backdrop-blur-md transition-[background-color,border-color,transform] duration-300',
            over ? 'scale-[1.01] border-(--l-accent) bg-(--l-accent)/20' : 'border-white/30 bg-black/35 hover:border-white/60',
          )}
        >
          <motion.span animate={over ? { y: -6 } : { y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
            <FileUp className="size-9 text-(--l-accent)" aria-hidden />
          </motion.span>
          <p className="display t-h3">Arrastra aquí tu plano</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="inline-flex h-12 items-center rounded-full bg-(--l-accent) px-7 font-medium text-(--l-on-accent) transition-[transform,background-color] duration-300 hover:-translate-y-0.5 hover:bg-(--l-accent-hi) active:translate-y-0"
          >
            Elegir archivo
          </button>
          <p className="t-small text-(--l-dim)">JPG, PNG, WEBP, PDF o DXF, hasta 25 MB</p>
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => go(e.target.files?.[0])} />
        </div>
      </div>
    </section>
  )
}

const FOOTER_LINKS = [
  { to: '/nuevo', label: 'Convertir un plano' },
  { to: '/proyectos', label: 'Mis proyectos' },
  { to: '/tutoriales/recorrer.webm', label: 'Tutorial: recorrer en 3D', file: true },
] as const

/** Cierre de la página: el nombre a todo el ancho y, debajo, enlaces y créditos. */
export function Footer() {
  return (
    <footer className="l-dark l-grain">
      <div className="frame grid gap-12 pt-20 pb-10">
        <div className="flex flex-col gap-8 border-b border-(--l-rule) pb-12 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-3">
            <Mark className="size-9" />
            <p className="max-w-xs text-(--l-dim)">Del plano a la casa: modelo, recorrido y cantidades de obra desde una foto.</p>
          </div>
          <nav aria-label="Pie de página" className="flex flex-wrap gap-x-8">
            {FOOTER_LINKS.map((l) =>
              'file' in l ? (
                <a key={l.to} href={l.to} className="inline-flex min-h-11 items-center">
                  <span className="l-link">{l.label}</span>
                </a>
              ) : (
                <Link key={l.to} to={l.to} className="inline-flex min-h-11 items-center">
                  <span className="l-link">{l.label}</span>
                </Link>
              ),
            )}
          </nav>
        </div>
        {/* sin animación de entrada: al final de la página el disparador puede no alcanzarse */}
        <p className="display overflow-hidden text-[clamp(3.5rem,24vw,26rem)] leading-[0.8] font-[300] whitespace-nowrap tracking-[-0.05em]" aria-hidden>
          Plano <em className="text-(--l-text-accent)">3D</em>
        </p>
        <p className="t-small text-(--l-dim)">Proyecto final de Programación Orientada a Objetos · Bogotá, 2026</p>
      </div>
    </footer>
  )
}
