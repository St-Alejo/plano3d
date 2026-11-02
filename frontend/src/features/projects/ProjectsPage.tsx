import { ArrowRight, Box, Camera, FileImage, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api/client'
import type { ProjectSummary } from '@/api/types'
import { Badge, Button, EmptyState, ErrorState, Menu, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { listProjects, relativeTime, SORT_LABEL, totalArea, type ProjectSort } from './listing'
import { STATUS_LABEL } from './status'

const dateFmt = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

/** Tarjeta de proyecto: miniatura grande, nombre, una línea de datos y "Abrir". */
function ProjectCard({ p, onDelete }: { p: ProjectSummary; onDelete: (p: ProjectSummary) => void }) {
  const status = STATUS_LABEL[p.status]
  const updated = new Date(p.updated_at)
  return (
    <li className="group relative flex flex-col rounded-xl border border-line bg-surface p-2 shadow-xs transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_24px_48px_-24px_rgb(28_31_29/0.35)] focus-within:border-line-strong">
      <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-paper">
        {p.status === 'ready' && p.has_source !== false ? (
          <img
            src={api.imageUrl(p.id, 'rectified', p.updated_at)}
            alt=""
            loading="lazy"
            className="size-full object-contain p-5 transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="blueprint-grid flex size-full items-center justify-center text-subtle">
            <FileImage className="size-10" aria-hidden />
          </div>
        )}
        {/* insignia discreta en la esquina, con fondo sólido porque va sobre la miniatura */}
        <span className="absolute top-2.5 left-2.5 rounded-full bg-surface/95 shadow-xs">
          <Badge tone={status.tone}>{status.text}</Badge>
        </span>
      </div>
      <div className="flex flex-col px-2 pt-1.5 pb-2">
        <h2 className="pr-10 text-lg leading-snug tracking-[-0.02em]">
          {/* el enlace cubre toda la tarjeta; el menú queda por encima */}
          <Link
            to={`/p/${p.id}`}
            className="inline-flex min-h-11 items-center after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
          >
            {p.name}
          </Link>
        </h2>
        <p className="text-sm text-muted">
          <span className="font-mono text-[13px] text-fg">{p.total_area != null ? `${p.total_area.toFixed(1)} m²` : '— m²'}</span>
          <span aria-hidden> · </span>
          {p.room_count} {p.room_count === 1 ? 'ambiente' : 'ambientes'}
          <span aria-hidden> · </span>
          <time dateTime={p.updated_at} title={dateFmt.format(updated)}>
            {relativeTime(p.updated_at)}
          </time>
        </p>
        <span aria-hidden className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand">
          Abrir
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </div>
      <div className="absolute right-2 bottom-2.5 z-10">
        <Menu
          trigger={
            <button
              type="button"
              aria-label={`Más acciones de ${p.name}`}
              className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg pointer-coarse:size-11"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          }
          items={[
            { label: 'Recorrer en 3D', icon: <Box className="size-4" />, href: `/p/${p.id}/3d` },
            { label: 'Eliminar', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDelete(p) },
          ]}
        />
      </div>
    </li>
  )
}

export function ProjectsPage() {
  const { data, error, loading, reload, setData } = useAsync(api.listProjects, [])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSort>('recent')
  const shown = useMemo(() => listProjects(data ?? [], query, sort), [data, query, sort])
  const searchId = useId()
  const sortId = useId()

  const remove = async (p: ProjectSummary) => {
    if (!window.confirm(`¿Eliminar "${p.name}"? No se puede deshacer.`)) return
    await api.deleteProject(p.id)
    setData((data ?? []).filter((x) => x.id !== p.id))
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.04em] text-accent uppercase">Proyectos</p>
          <h1 className="mt-3 text-5xl leading-[0.95] tracking-[-0.045em] sm:text-6xl">Tus planos</h1>
          {data && data.length > 0 && (
            <p className="mt-4 inline-flex rounded-full bg-raised px-3 py-1 text-sm text-muted">
              {data.length} {data.length === 1 ? 'plano' : 'planos'} · {totalArea(data).toFixed(1)} m² modelados
            </p>
          )}
        </div>
        <Link
          to="/nuevo"
          className="group inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 font-medium text-brand-ink shadow-sm transition-[filter,transform] duration-200 hover:-translate-y-0.5 hover:brightness-110"
        >
          <Plus className="size-4 transition-transform duration-300 group-hover:rotate-90" aria-hidden /> Convertir un plano
        </Link>
      </header>

      {data && data.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-3" role="search">
          <label htmlFor={searchId} className="sr-only">
            Buscar planos
          </label>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre"
              className="h-11 w-full rounded-full border border-line-strong bg-surface pr-4 pl-9 text-sm transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none sm:h-10"
            />
          </div>
          <label htmlFor={sortId} className="ml-auto text-sm text-muted">
            Ordenar
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => setSort(e.target.value as ProjectSort)}
            className="h-11 rounded-full border border-line-strong bg-surface px-4 text-sm sm:h-10"
          >
            {(Object.keys(SORT_LABEL) as ProjectSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && !data && <Spinner label="Cargando proyectos" />}
      {error && (
        <ErrorState
          title="No se pudieron cargar los proyectos"
          message={error.message}
          action={<Button onClick={reload}>Reintentar</Button>}
        />
      )}
      {data && data.length === 0 && (
        <EmptyState
          icon={<Camera className="size-10" aria-hidden />}
          title="Todavía no hay planos"
          message="Toma una foto de un plano impreso (o sube una imagen o PDF) y en segundos podrás recorrerlo en 3D."
          action={
            <Link
              to="/nuevo"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 font-medium text-brand-ink shadow-sm hover:brightness-110"
            >
              <Camera className="size-4" aria-hidden /> Tomar foto de un plano
            </Link>
          }
        />
      )}
      {data && data.length > 0 && shown.length === 0 && (
        <p role="status" className="py-12 text-center text-muted">
          Ningún plano coincide con «{query}».
        </p>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Proyectos">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} onDelete={(x) => void remove(x)} />
          ))}
        </ul>
      )}
    </div>
  )
}
