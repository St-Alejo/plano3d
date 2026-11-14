/**
 * Cantidades de obra, en banda oscura: a la izquierda qué se calcula y por qué se puede
 * confiar, sobre la foto del material; a la derecha el cálculo real, cargado aparte para no
 * sumar el dominio de obra al primer pintado.
 */
import { ArrowRight } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router'

import { Photo } from '@/components/Photo'
import { DimLine, Parallax } from './motion'
import { Reveal, Stagger, StaggerItem } from './reveal'

const QuantitiesDemo = lazy(() => import('./QuantitiesDemo'))

export function Quantities() {
  return (
    <section aria-labelledby="cantidades" className="l-dark l-grain py-24 sm:py-36">
      <div className="frame grid gap-14 lg:grid-cols-[5fr_7fr] lg:items-start lg:gap-20">
        <div className="grid gap-10 lg:sticky lg:top-28">
          <Stagger className="grid gap-6" gap={0.09}>
            <StaggerItem>
              <DimLine index={5} label="Cantidades de obra" />
            </StaggerItem>
            <StaggerItem>
              <h2 id="cantidades" className="t-h2">
                Cuánto ladrillo lleva tu casa.
              </h2>
            </StaggerItem>
            <StaggerItem>
              <p className="t-lead max-w-md text-(--l-dim)">
                Del mismo modelo salen la cimentación, las columnetas, las vigas y el acero según la NSR-10, y con ellos la lista de compra por etapa de la obra.
              </p>
            </StaggerItem>
            <StaggerItem>
              <p className="max-w-md">Prueba con este apartamento de 50 m²: cambia la pieza y mira cómo cambia todo lo demás.</p>
            </StaggerItem>
            <StaggerItem>
              <Link to="/nuevo" className="group inline-flex min-h-11 w-fit items-center gap-2 font-medium text-(--l-text-accent)">
                <span className="l-link">Calcular la mía</span> <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
              </Link>
            </StaggerItem>
          </Stagger>
          <Parallax distance={30} className="hidden aspect-[16/10] overflow-hidden rounded-xl lg:block">
            <Photo name="materiales" sizes="(min-width: 1024px) 36vw, 0px" className="size-full scale-110 object-cover" />
          </Parallax>
        </div>
        <Reveal>
          <Suspense fallback={<div className="aspect-[4/3] rounded-xl bg-(--l-card)" />}>
            <QuantitiesDemo />
          </Suspense>
        </Reveal>
      </div>
    </section>
  )
}
