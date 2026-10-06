/**
 * Landing "Lámina A-01": la página de entrada presentada como una lámina de
 * arquitectura. Va fuera del AppShell (tiene su propio cajetín) y siempre en papel.
 */
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'

import { HeroStage } from './HeroStage'
import { AreaSchedule, BeforeAfter, DropCta, EditorDiagram, SectionHead, SpecSheet, TitleBlock } from './sections'

function Masthead() {
  return (
    <header className="border-b border-(--l-ink)">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-4 py-3 sm:px-8">
        <Link to="/" className="flex min-h-11 items-baseline gap-1.5" aria-label="Plano 3D, inicio">
          <span className="serif text-3xl leading-none">Plano</span>
          <span className="font-mono text-sm font-medium text-(--l-signal-ink)">3D</span>
        </Link>
        <p className="hidden font-mono text-[11px] tracking-[0.16em] text-(--l-graphite) uppercase lg:block">
          Lámina A-01 · Escala 1:50 · Bogotá, 2026
        </p>
        <nav aria-label="Secciones" className="flex items-center gap-1 text-sm">
          <a href="#especificaciones" className="hidden min-h-11 items-center px-3 hover:text-(--l-signal-ink) md:inline-flex">
            Qué hace
          </a>
          <a href="#editor" className="hidden min-h-11 items-center px-3 hover:text-(--l-signal-ink) md:inline-flex">
            Editor
          </a>
          <a href="#areas" className="hidden min-h-11 items-center px-3 hover:text-(--l-signal-ink) md:inline-flex">
            Áreas
          </a>
          <Link
            to="/proyectos"
            className="ml-2 inline-flex min-h-11 items-center gap-1.5 border border-(--l-ink) px-4 font-medium hover:bg-(--l-ink) hover:text-(--l-paper)"
          >
            Abrir la app <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  )
}

function HeroActions() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
      <Link
        to="/nuevo"
        className="inline-flex h-12 items-center gap-2 bg-(--l-signal) px-6 font-medium text-(--l-ink) hover:bg-(--l-ink) hover:text-(--l-paper)"
      >
        Convertir un plano <ArrowRight className="size-4" aria-hidden />
      </Link>
      <a href="#antes-despues" className="inline-flex min-h-11 items-center border-b border-(--l-ink) font-medium hover:text-(--l-signal-ink)">
        Ver el resultado
      </a>
    </div>
  )
}

export function LandingPage() {
  useEffect(() => {
    document.title = 'Plano 3D — de la hoja al espacio que recorres'
    return () => {
      document.title = 'Plano 3D'
    }
  }, [])
  return (
    <div className="lamina mm-grid min-h-full">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-(--l-ink) focus:px-3 focus:py-2 focus:text-(--l-paper)"
      >
        Saltar al contenido
      </a>
      <Masthead />
      <main id="contenido">
        <HeroStage actions={<HeroActions />} />

        <div className="mx-auto grid max-w-[1400px] gap-28 px-4 py-24 sm:px-8">
          <section aria-labelledby="antes-despues" className="grid gap-10">
            <SectionHead cut="A" id="antes-despues" kicker="Comparación" title={<>La misma hoja, <em>levantada.</em></>} />
            <BeforeAfter />
          </section>

          <section aria-labelledby="especificaciones" className="grid gap-10">
            <SectionHead cut="B" id="especificaciones" kicker="Especificaciones" title="Qué entra, qué sale." />
            <SpecSheet />
          </section>

          <section aria-labelledby="editor" className="grid gap-10">
            <SectionHead cut="C" id="editor" kicker="Editor" title={<>Lo que la máquina no ve, <em>lo corriges tú.</em></>} />
            <EditorDiagram />
          </section>

          <section aria-labelledby="areas" className="grid gap-10">
            <SectionHead cut="D" id="areas" kicker="Cuadro de áreas" title="Cada ambiente, medido." />
            <AreaSchedule />
          </section>

          <section aria-labelledby="empezar" className="grid gap-10">
            <SectionHead cut="E" id="empezar" kicker="Empezar" title="Tu plano, en 3D, hoy." />
            <DropCta />
          </section>
        </div>
      </main>
      <TitleBlock />
    </div>
  )
}
