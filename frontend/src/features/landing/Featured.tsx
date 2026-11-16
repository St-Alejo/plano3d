/**
 * Proyectos destacados: la casa de muestra que se abre sin cuenta. Una banda oscura con la
 * portada (o el video del recorrido) a todo lo ancho, sus cifras y el enlace al visor público.
 * Si la API no responde la sección no aparece: la portada nunca depende de ella.
 */
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { api, type Featured } from '@/api/client'
import { useAsync } from '@/hooks/useAsync'
import { DimLine } from './motion'
import { Reveal } from './reveal'

const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 })

function FeaturedCard({ f }: { f: Featured }) {
  const stats = [
    { value: f.levels, label: f.levels === 1 ? 'piso' : 'pisos' },
    { value: f.rooms, label: 'ambientes' },
    { value: fmt(f.total_area), label: 'm² construidos' },
  ]
  return (
    <article aria-labelledby={`destacado-${f.id}`} className="grid gap-10 lg:grid-cols-[7fr_5fr] lg:items-end lg:gap-16">
      <div className="relative overflow-hidden rounded-2xl bg-black/40">
        {f.video ? (
          <video src={f.video} poster={f.cover ?? undefined} className="aspect-video w-full object-cover" autoPlay muted loop playsInline controls aria-label={`Recorrido por ${f.name}`} />
        ) : f.cover ? (
          <img src={f.cover} alt={`Fachada de ${f.name}, render en Blender`} className="aspect-video w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="grid gap-7">
        <h3 id={`destacado-${f.id}`} className="display t-h2">
          {f.name}
        </h3>
        <p className="t-lead text-(--l-dim)">{f.summary}</p>
        <dl className="grid grid-cols-3 gap-4 border-t border-(--l-rule) pt-6">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="sr-only">{s.label}</dt>
              <dd className="display text-4xl leading-none">{s.value}</dd>
              <dd aria-hidden className="t-small mt-2 text-(--l-dim)">
                {s.label}
              </dd>
            </div>
          ))}
        </dl>
        <Link
          to={`/destacados/${encodeURIComponent(f.id)}`}
          className="group inline-flex h-14 w-fit items-center gap-3 rounded-full bg-(--l-accent) pr-2 pl-7 font-medium text-(--l-on-accent) transition-[transform,background-color] duration-300 hover:-translate-y-0.5 hover:bg-(--l-accent-hi)"
        >
          Recorrerla en 3D
          <span className="grid size-10 place-items-center rounded-full bg-black/15 transition-transform duration-300 group-hover:translate-x-0.5">
            <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      </div>
    </article>
  )
}

export function FeaturedProjects() {
  const { data } = useAsync(() => api.featured.list(), [])
  if (!data?.length) return null
  return (
    <section aria-labelledby="destacados" className="l-dark l-grain">
      <div className="frame grid gap-14 py-16 sm:py-24">
        <div className="grid max-w-3xl gap-6">
          <DimLine index={6} label="Proyecto destacado" />
          <h2 id="destacados" className="t-h2">
            Una casa terminada, para recorrer sin cuenta.
          </h2>
        </div>
        {data.map((f) => (
          <Reveal key={f.id}>
            <FeaturedCard f={f} />
          </Reveal>
        ))}
      </div>
    </section>
  )
}
