/**
 * Cantidades de obra: a la izquierda qué se calcula y por qué se puede confiar; a la derecha
 * el cálculo real, cargado aparte para no sumar el dominio de obra al primer pintado.
 */
import { ArrowRight } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router'

import { Reveal, Stagger, StaggerItem } from './reveal'

const QuantitiesDemo = lazy(() => import('./QuantitiesDemo'))

export function Quantities() {
  return (
    <section aria-labelledby="cantidades" className="frame grid gap-12 py-20 sm:py-32 lg:grid-cols-[5fr_7fr] lg:items-start lg:gap-20">
      <Stagger className="grid gap-5 lg:sticky lg:top-28" gap={0.09}>
        <StaggerItem>
          <h2 id="cantidades" className="t-h2">
            Cuánto ladrillo lleva tu casa.
          </h2>
        </StaggerItem>
        <StaggerItem>
          <p className="t-lead max-w-md">
            Del mismo modelo salen la cimentación, las columnetas, las vigas y el acero según la NSR-10, y con ellos la lista de compra por etapa de la obra.
          </p>
        </StaggerItem>
        <StaggerItem>
          <p className="max-w-md">Prueba con este apartamento de 50 m²: cambia la pieza y mira cómo cambia todo lo demás.</p>
        </StaggerItem>
        <StaggerItem>
          <Link to="/nuevo" className="group inline-flex min-h-11 w-fit items-center gap-2 font-medium underline decoration-(--l-signal) decoration-2 underline-offset-[6px]">
            Calcular la mía <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
          </Link>
        </StaggerItem>
      </Stagger>
      <Reveal>
        <Suspense fallback={<div className="aspect-[4/3] rounded-lg bg-(--l-sheet)" />}>
          <QuantitiesDemo />
        </Suspense>
      </Reveal>
    </section>
  )
}
