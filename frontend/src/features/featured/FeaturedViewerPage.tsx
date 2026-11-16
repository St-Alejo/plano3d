/**
 * Visor público de un proyecto destacado: la maqueta 3D con fachada y muebles, sin cuenta y de
 * solo lectura. Para editarla o caminarla por dentro se entra con la cuenta demo, que la tiene.
 */
import { ArrowLeft, Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { api } from '@/api/client'
import { Button, ErrorState, Spinner } from '@/components/ui'
import { withRealStairs } from '@/domain/stairDesign'
import { useAsync } from '@/hooks/useAsync'
import { Viewer3D } from '@/features/viewer3d/Viewer3D'

export function FeaturedViewerPage() {
  const { id = '' } = useParams()
  const { data: project, error, loading, reload } = useAsync(() => api.featured.get(id), [id])
  const model = useMemo(() => (project?.model ? withRealStairs(project.model) : undefined), [project])
  const [rotate, setRotate] = useState(true)

  useEffect(() => {
    if (project) document.title = `${project.name} · Plano 3D`
    return () => {
      document.title = 'Plano 3D'
    }
  }, [project])

  if (loading) return <div className="grid h-dvh place-items-center"><Spinner label="Cargando la casa" /></div>
  if (error || !project || !model) {
    return (
      <div className="grid h-dvh place-items-center p-6">
        <ErrorState
          title="No encontramos ese proyecto"
          message={error?.message ?? 'Puede que ya no esté destacado.'}
          action={
            <div className="flex gap-3">
              <Button onClick={reload}>Reintentar</Button>
              <Link to="/" className="inline-flex h-10 items-center px-3 text-sm underline">Ir al inicio</Link>
            </div>
          }
        />
      </div>
    )
  }
  return (
    <div className="relative h-dvh overflow-hidden bg-canvas">
      <Viewer3D model={model} className="absolute inset-0" label={`Modelo 3D de ${project.name}`} quality="alta" facade furniture autoRotate={rotate} />
      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-canvas/85 px-3 py-2 backdrop-blur">
          <Link to="/" aria-label="Volver al inicio" className="grid size-10 place-items-center rounded-lg hover:bg-black/5">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <div>
            <h1 className="text-base leading-tight font-medium">{project.name}</h1>
            <p className="text-xs text-muted">
              {model.levels.length} pisos · {Math.round(model.total_area ?? 0)} m² · solo lectura
            </p>
          </div>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <Button
            className="h-11 bg-canvas/85 backdrop-blur"
            aria-pressed={rotate}
            onClick={() => setRotate((r) => !r)}
            icon={rotate ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          >
            {rotate ? 'Detener giro' : 'Girar'}
          </Button>
          <Link to="/entrar" className="inline-flex h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white">
            Editarla con la cuenta demo
          </Link>
        </div>
      </header>
    </div>
  )
}
