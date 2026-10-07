import { ArrowUpRight, Camera, FileImage, Plus, Search, Trash2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api/client'
import type { ProjectSummary } from '@/api/types'
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { listProjects, SORT_LABEL, totalArea, type ProjectSort } from './listing'
import { STATUS_LABEL } from './status'

const dateFmt = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

function ProjectCard({ p, onDelete }: { p: ProjectSummary; onDelete: (p: ProjectSummary) => void }) {
  const status = STATUS_LABEL[p.status]
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xs transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_18px_40px_-20px_rgb(28_31_29/0.35)]">
      <Link to={`/p/${p.id}`} className="flex flex-1 flex-col focus-visible:outline-offset-4">
        <div className="relative m-2 mb-0 aspect-[4/3] overflow-hidden rounded-xl bg-paper">
          {p.status === 'ready' ? (
            <img
              src={api.imageUrl(p.id, 'rectified', p.updated_at)}
              alt=""
              loading="lazy"
              className="size-full object-contain p-4 transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <div className="blueprint-grid flex size-full items-center justify-center text-subtle">
              <FileImage className="size-10" aria-hidden />
            </div>
          )}
          {/* fondo sólido detrás de la insignia: va sobre la miniatura */}
          <span className="absolute top-3 left-3 rounded-full bg-surface shadow-sm">
            <Badge tone={status.tone}>{status.text}</Badge>
          </span>
        </div>
        <div className="flex flex-col gap-3 p-4 pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-[17px] leading-snug tracking-[-0.02em]">{p.name}</h2>
            <ArrowUpRight
              className="mt-0.5 size-4 shrink-0 text-subtle transition-[transform,color] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
              aria-hidden
            />
          </div>
          <dl className="flex items-center gap-3 text-sm text-muted">
            <div>
              <dt className="sr-only">Superficie</dt>
              <dd className="font-mono text-[13px] text-fg">{p.total_area != null ? `${p.total_area.toFixed(1)} m²` : '— m²'}</dd>
            </div>
            <span className="size-1 rounded-full bg-line-strong" aria-hidden />
            <div>
              <dt className="sr-only">Ambientes</dt>
              <dd>{p.room_count} amb.</dd>
            </div>
            <div className="ml-auto">
              <dt className="sr-only">Actualizado</dt>
              <dd className="text-xs text-subtle">{dateFmt.format(new Date(p.updated_at))}</dd>
            </div>
          </dl>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onDelete(p)}
        aria-label={`Eliminar ${p.name}`}
        className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-full bg-surface/90 text-muted opacity-0 shadow-sm backdrop-blur transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
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
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Proyectos">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} onDelete={(x) => void remove(x)} />
          ))}
        </ul>
      )}
    </div>
  )
}
