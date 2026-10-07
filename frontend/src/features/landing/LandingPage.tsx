/**
 * Página de entrada. Va fuera del AppShell (tiene su propia cabecera y pie) y
 * siempre en claro, sin depender del tema de la app.
 */
import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { motion, MotionConfig, useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { HeroStage } from './HeroStage'
import { EASE } from './ease'
import { AreaSchedule, BeforeAfter, DropCta, EditorDiagram, Footer, SectionHead, Specs } from './sections'

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="var(--l-signal)" />
      <path d="M7 17V7h6v5h4v5Z" fill="none" stroke="var(--l-paper)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

const NAV = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#editor', label: 'Editor' },
  { href: '#areas', label: 'Áreas' },
]

/** Cabecera fija: se compacta y gana sombra al bajar; debajo, la barra de progreso de lectura. */
function Masthead() {
  const { scrollY, scrollYProgress } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 12))
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 })
  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: EASE }}
      className={clsx(
        'sticky top-0 z-30 border-b backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-300',
        scrolled ? 'border-(--l-hair) bg-(--l-paper)/80 shadow-[0_6px_24px_-12px_rgb(28_31_29/0.18)]' : 'border-transparent bg-(--l-paper)/0',
      )}
    >
      <div
        className={clsx(
          'mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 transition-[padding] duration-300 sm:px-6',
          scrolled ? 'py-2' : 'py-4',
        )}
      >
        <Link to="/" className="group flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight" aria-label="Plano 3D, inicio">
          <span className="transition-transform duration-500 ease-out group-hover:rotate-[-8deg]">
            <Logo />
          </span>
          Plano 3D
        </Link>
        <nav aria-label="Secciones" className="flex items-center gap-1 text-[15px] text-(--l-graphite)">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="group relative hidden min-h-11 items-center px-3 transition-colors hover:text-(--l-ink) md:inline-flex"
            >
              {n.label}
              <span className="absolute inset-x-3 bottom-2.5 h-px origin-left scale-x-0 bg-(--l-ink) transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </a>
          ))}
          <Link
            to="/proyectos"
            className="ml-2 inline-flex min-h-11 items-center rounded-full border border-(--l-hair-strong) px-4 font-medium text-(--l-ink) transition-[background-color,color,border-color] duration-300 hover:border-(--l-ink) hover:bg-(--l-ink) hover:text-(--l-paper)"
          >
            Abrir la app
          </Link>
        </nav>
      </div>
      <motion.div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-(--l-signal)" style={{ scaleX: progress }} />
    </motion.header>
  )
}

function HeroActions() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <Link
        to="/nuevo"
        className="group inline-flex h-12 items-center gap-2 rounded-full bg-(--l-signal) px-6 font-medium text-white shadow-[0_8px_24px_-10px_var(--l-signal)] transition-[background-color,transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:bg-(--l-deep) hover:shadow-[0_14px_30px_-12px_var(--l-deep)] active:translate-y-0"
      >
        Convertir un plano <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
      </Link>
      <a href="#antes-despues" className="inline-flex h-12 items-center rounded-full px-5 font-medium transition-colors duration-300 hover:bg-(--l-paper-2)">
        Ver cómo queda
      </a>
    </div>
  )
}

export function LandingPage() {
  useEffect(() => {
    document.title = 'Plano 3D — fotografía tu plano y recórrelo en 3D'
    return () => {
      document.title = 'Plano 3D'
    }
  }, [])
  return (
    <MotionConfig reducedMotion="user">
    <div className="landing min-h-full">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-(--l-ink) focus:px-3 focus:py-2 focus:text-(--l-paper)"
      >
        Saltar al contenido
      </a>
      <Masthead />
      <main id="contenido">
        <HeroStage actions={<HeroActions />} />

        <div className="mx-auto grid max-w-6xl gap-28 px-4 py-24 sm:px-6 md:gap-36">
          <section aria-labelledby="antes-despues" className="grid gap-10">
            <SectionHead
              id="antes-despues"
              kicker="Antes y después"
              title="Del papel al modelo, sin dibujar nada."
              lead="Arrastra el divisor: a un lado el plano tal como lo subiste, al otro el modelo que sale de él."
            />
            <BeforeAfter />
          </section>

          <section aria-labelledby="como-funciona" className="grid gap-10">
            <SectionHead
              id="como-funciona"
              kicker="Cómo funciona"
              title="Qué le das y qué te devuelve."
              lead="No hace falta saber de CAD. Si el plano tiene cotas, las usa; si no, calibras con una medida que conozcas."
            />
            <Specs />
          </section>

          <section aria-labelledby="editor" className="grid gap-10">
            <SectionHead
              id="editor"
              kicker="Editor"
              title="Lo que la máquina no ve, lo corriges tú."
              lead="Ningún detector acierta siempre. Por eso cada muro, puerta y medida se puede ajustar a mano, y el 3D se actualiza mientras lo haces."
            />
            <EditorDiagram />
          </section>

          <section aria-labelledby="areas" className="grid gap-10">
            <SectionHead
              id="areas"
              kicker="Áreas"
              title="Cada ambiente, medido."
              lead="Los ambientes se recalculan solos a partir de los muros, así que el cuadro de áreas siempre está al día."
            />
            <AreaSchedule />
          </section>

          <section aria-labelledby="empezar">
            <DropCta />
          </section>
        </div>
      </main>
      <Footer />
    </div>
    </MotionConfig>
  )
}
