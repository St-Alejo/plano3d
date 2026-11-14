/**
 * Página de entrada. Va fuera del AppShell (tiene su propia cabecera y pie) y en la marca
 * "Obra limpia": hueso y grafito, con bandas oscuras para las pausas. Abre con la casa que se
 * construye a pantalla completa mientras bajas y sigue con una idea por pantalla.
 */
import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { motion, MotionConfig, useMotionValueEvent, useScroll } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { Mark } from '@/components/AppShell'
import { HeroStage } from './HeroStage'
import { Faq } from './Faq'
import { Formats } from './Formats'
import { HowItWorks } from './HowItWorks'
import { Quantities } from './Quantities'
import { EASE } from './ease'
import { BeforeAfter, CapabilitiesSection, Closing, Footer } from './sections'
import { useSmoothScroll } from './useSmoothScroll'
import { Walkthrough } from './Walkthrough'

const NAV = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#formatos', label: 'Formatos' },
  { href: '#cantidades', label: 'Cantidades' },
  { href: '#preguntas', label: 'Preguntas' },
]

/**
 * Cabecera fija: sobre las fotos del hero va en blanco y sin fondo; al salir de ellas toma el
 * hueso de la página con un borde fino.
 */
function Masthead() {
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => {
    // sobre las fotos (el hero y el recorrido) la cabecera va transparente
    const hero = document.getElementById('recorrido') ?? document.getElementById('hero')
    const end = hero ? hero.offsetTop + hero.offsetHeight - 80 : 80
    setSolid(y > end)
  })
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
      className={clsx(
        'fixed inset-x-0 top-0 z-30 transition-[background-color,border-color,color] duration-500',
        solid ? 'border-b border-(--l-rule) bg-(--l-bg)/92 backdrop-blur-md' : 'l-dark border-b border-transparent !bg-transparent',
      )}
    >
      <div className="frame flex items-center justify-between gap-6 py-3">
        <Link to="/" className="flex min-h-11 items-center gap-2.5 text-lg font-semibold tracking-tight" aria-label="Plano 3D, inicio">
          <Mark className="size-7" />
          <span aria-hidden>Plano 3D</span>
        </Link>
        <nav aria-label="Secciones" className="flex items-center gap-1">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hidden min-h-11 items-center px-3 t-small md:inline-flex">
              <span className="l-link">{n.label}</span>
            </a>
          ))}
          <Link
            to="/proyectos"
            className="ml-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-(--l-fg)/25 px-5 t-small font-medium transition-[background-color,color,border-color] duration-300 hover:border-(--l-fg) hover:bg-(--l-fg) hover:text-(--l-bg)"
          >
            Abrir la app
          </Link>
        </nav>
      </div>
    </motion.header>
  )
}

function HeroActions() {
  return (
    <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
      <Link
        to="/nuevo"
        className="group inline-flex h-14 items-center gap-3 rounded-full bg-(--l-accent) pr-2 pl-7 font-medium text-(--l-on-accent) shadow-[0_18px_40px_-18px_rgb(168_75_38/0.9)] transition-[transform,background-color] duration-300 ease-out hover:-translate-y-0.5 hover:bg-(--l-accent-hi) active:translate-y-0"
      >
        Convertir un plano
        <span className="grid size-10 place-items-center rounded-full bg-black/15 transition-transform duration-300 group-hover:translate-x-0.5">
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </Link>
      <a href="#como-funciona" className="inline-flex min-h-11 items-center t-small text-(--l-dim) transition-colors hover:text-(--l-fg)">
        <span className="l-link">Ver cómo funciona</span>
      </a>
    </div>
  )
}

export function LandingPage() {
  useSmoothScroll()
  useEffect(() => {
    document.title = 'Plano 3D: de la foto de tu plano a tu casa en 3D'
    return () => {
      document.title = 'Plano 3D'
    }
  }, [])
  return (
    <MotionConfig reducedMotion="user">
      <div className="landing min-h-full">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-(--l-fg) focus:px-3 focus:py-2 focus:text-(--l-bg)"
        >
          Saltar al contenido
        </a>
        <Masthead />
        <main id="contenido">
          <HeroStage actions={<HeroActions />} />
          <Walkthrough />
          <HowItWorks />
          <CapabilitiesSection />
          <Formats />
          <BeforeAfter />
          <Quantities />
          <Faq />
          <Closing />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
