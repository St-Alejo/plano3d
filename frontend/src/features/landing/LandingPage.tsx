/**
 * Página de entrada. Va fuera del AppShell (tiene su propia cabecera y pie) y siempre en su
 * propio tema de noche, sin depender del tema de la app: la casa se construye en pantalla
 * completa y el resto de la página sigue en el mismo tono, con un solo acento dorado.
 */
import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { motion, MotionConfig, useMotionValueEvent, useScroll } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { HeroStage } from './HeroStage'
import { EASE } from './ease'
import { BeforeAfter, Capabilities, Closing, Footer, SectionHead } from './sections'
import { useSmoothScroll } from './useSmoothScroll'

const NAV = [
  { href: '#que-puedes-hacer', label: 'Qué hace' },
  { href: '#antes-despues', label: 'Antes y después' },
]

/**
 * Barra simple: el nombre, dos enlaces y una acción. Sobre la escena del hero va sin fondo;
 * al salir de ella toma el color de la página (sin vidrio ni sombra).
 */
function Masthead() {
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => {
    const hero = document.getElementById('hero')
    const end = hero ? hero.offsetTop + hero.offsetHeight - 80 : 80
    setSolid(y > end)
  })
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
      className={clsx('fixed inset-x-0 top-0 z-30 transition-colors duration-300', solid ? 'bg-(--l-night)' : 'bg-transparent')}
    >
      <div className="frame flex items-center justify-between gap-6 py-4">
        <Link to="/" className="display t-h3 flex min-h-11 items-center leading-none" aria-label="Plano 3D, inicio">
          Plano 3D
        </Link>
        <nav aria-label="Secciones" className="flex items-center gap-2">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hidden min-h-11 items-center px-3 t-small transition-opacity hover:opacity-70 md:inline-flex">
              {n.label}
            </a>
          ))}
          <Link
            to="/proyectos"
            className="ml-2 inline-flex min-h-11 items-center rounded-full bg-(--l-ink) px-5 t-small font-medium text-(--l-night) transition-[background-color,color] duration-300 hover:bg-(--l-signal) hover:text-(--l-on-signal)"
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
    <div className="mt-8">
      <Link
        to="/nuevo"
        className="group inline-flex h-13 items-center gap-2 rounded-full bg-(--l-signal) px-7 font-medium text-(--l-on-signal) transition-[transform,background-color] duration-300 ease-out hover:-translate-y-0.5 hover:bg-(--l-signal-hi) active:translate-y-0"
      >
        Convertir un plano <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
      </Link>
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
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-(--l-ink) focus:px-3 focus:py-2 focus:text-(--l-night)"
        >
          Saltar al contenido
        </a>
        <Masthead />
        <main id="contenido">
          <HeroStage actions={<HeroActions />} />

          <section aria-labelledby="que-puedes-hacer" className="frame grid gap-16 py-20 sm:py-32">
            <SectionHead id="que-puedes-hacer" title="Todo lo que sale de un plano." />
            <Capabilities />
          </section>

          <section aria-labelledby="antes-despues" className="frame grid gap-12 py-20 sm:py-32">
            <SectionHead id="antes-despues" title="Del papel al modelo." lead="Arrastra el divisor: el mismo apartamento, en la misma escala." />
            <BeforeAfter />
          </section>

          <section aria-labelledby="empezar" className="py-20 sm:py-32">
            <Closing />
          </section>
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
