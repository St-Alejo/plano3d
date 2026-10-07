/**
 * Página de entrada. Va fuera del AppShell (tiene su propia cabecera y pie) y
 * siempre en claro, sin depender del tema de la app.
 */
import { ArrowRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'

import { HeroStage } from './HeroStage'
import { AreaSchedule, BeforeAfter, DropCta, EditorDiagram, Footer, SectionHead, Specs } from './sections'

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="var(--l-signal)" />
      <path d="M7 17V7h6v5h4v5Z" fill="none" stroke="var(--l-paper)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function Masthead() {
  return (
    <header className="sticky top-0 z-30 border-b border-(--l-hair) bg-(--l-paper)/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
        <Link to="/" className="flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight" aria-label="Plano 3D, inicio">
          <Logo />
          Plano 3D
        </Link>
        <nav aria-label="Secciones" className="flex items-center gap-1 text-[15px] text-(--l-graphite)">
          <a href="#como-funciona" className="hidden min-h-11 items-center px-3 hover:text-(--l-ink) md:inline-flex">
            Cómo funciona
          </a>
          <a href="#editor" className="hidden min-h-11 items-center px-3 hover:text-(--l-ink) md:inline-flex">
            Editor
          </a>
          <a href="#areas" className="hidden min-h-11 items-center px-3 hover:text-(--l-ink) md:inline-flex">
            Áreas
          </a>
          <Link
            to="/proyectos"
            className="ml-2 inline-flex min-h-11 items-center rounded-full border border-(--l-hair-strong) px-4 font-medium text-(--l-ink) hover:border-(--l-ink)"
          >
            Abrir la app
          </Link>
        </nav>
      </div>
    </header>
  )
}

function HeroActions() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <Link
        to="/nuevo"
        className="inline-flex h-12 items-center gap-2 rounded-full bg-(--l-signal) px-6 font-medium text-white hover:bg-(--l-deep)"
      >
        Convertir un plano <ArrowRight className="size-4" aria-hidden />
      </Link>
      <a href="#antes-despues" className="inline-flex h-12 items-center rounded-full px-5 font-medium hover:bg-(--l-paper-2)">
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
  )
}
