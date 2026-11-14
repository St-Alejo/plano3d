import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { Photo } from './Photo'

/** 404: el pasillo de obra que termina en un muro, y el camino de vuelta. */
export function NotFound() {
  return (
    <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
      <div className="overflow-hidden rounded-xl shadow-lift">
        <Photo name="no-encontrado" sizes="(min-width: 1024px) 55vw, 100vw" priority className="aspect-[16/10] w-full object-cover" />
      </div>
      <div role="alert" className="flex flex-col items-start gap-5">
        <p className="flex items-center gap-3 font-mono text-xs font-medium tracking-[0.14em] text-accent uppercase">
          <span aria-hidden className="h-px w-8 bg-accent" />
          Error 404
        </p>
        <h2 className="text-5xl leading-[0.95] font-[380] tracking-[-0.04em] sm:text-6xl">Página no encontrada</h2>
        <p className="max-w-md text-muted">Este pasillo termina en un muro: la dirección no existe o el proyecto ya se eliminó.</p>
        <Link
          to="/proyectos"
          className="group inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 font-medium text-brand-ink shadow-card transition-[filter,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lift hover:brightness-110"
        >
          Ir a proyectos <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
