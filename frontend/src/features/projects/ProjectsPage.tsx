import { Camera, FileImage, Plus, Search, Trash2 } from 'lucide-react'
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
    <li className="group corner-ticks relative flex flex-col border border-line bg-surface transition hover:border-accent-dim">
      <Link to={`/p/${p.id}`} className="flex flex-1 flex-col focus-visible:outline-offset-4">
        <div className="blueprint-grid relative aspect-[4/3] overflow-hidden border-b border-line bg-canvas">
          {p.status === 'ready' ? (
            <img
              src={api.imageUrl(p.id, 'rectified', p.updated_at)}
              alt=""
              loading="lazy"
              className="size-full object-contain p-3 opacity-90 mix-blend-luminosity"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-subtle">
              <FileImage className="size-10" aria-hidden />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display text-base font-semibold leading-tight">{p.name}</h2>
            <Badge tone={status.tone}>{status.text}</Badge>
          </div>
          <dl className="flex gap-4 font-mono text-xs text-muted">
            <div>
              <dt className="sr-only">Superficie</dt>
              <dd>{p.total_area != null ? `${p.total_area.toFixed(1)} m²` : '— m²'}</dd>
            </div>
            <div>
              <dt className="sr-only">Ambientes</dt>
              <dd>{p.room_count} amb.</dd>
            </div>
            <div className="ml-auto">
              <dt className="sr-only">Actualizado</dt>
              <dd>{dateFmt.format(new Date(p.updated_at))}</dd>
            </div>
          </dl>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onDelete(p)}
        aria-label={`Eliminar ${p.name}`}
        className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-md bg-canvas/80 text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
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
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <p className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">01 — Proyectos</p>
          <h1 className="mt-2 font-serif text-5xl leading-none font-normal tracking-tight sm:text-6xl">Tus planos</h1>
          {data && data.length > 0 && (
            <p className="mt-3 font-mono text-xs text-muted">
              {data.length} {data.length === 1 ? 'plano' : 'planos'} · {totalArea(data).toFixed(1)} m² modelados
            </p>
          )}
        </div>
        <Link
          to="/nuevo"
          className="inline-flex h-11 items-center gap-2 rounded-md bg-brand px-5 font-medium text-brand-ink hover:brightness-110"
        >
          <Plus className="size-4" aria-hidden /> Convertir un plano
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
              className="h-11 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-subtle sm:h-10"
            />
          </div>
          <label htmlFor={sortId} className="ml-auto font-mono text-xs text-muted">
            Ordenar
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => setSort(e.target.value as ProjectSort)}
            className="h-11 rounded-md border border-line-strong bg-surface px-3 text-sm sm:h-10"
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
              className="inline-flex h-11 items-center gap-2 rounded-md bg-brand px-5 font-medium text-brand-ink hover:brightness-110"
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Proyectos">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} onDelete={(x) => void remove(x)} />
          ))}
        </ul>
      )}
    </div>
  )
}
