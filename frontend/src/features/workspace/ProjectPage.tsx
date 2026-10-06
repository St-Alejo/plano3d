import { RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '@/api/client'
import { Badge, Button, ErrorState, Spinner } from '@/components/ui'
import { STATUS_LABEL } from '@/features/projects/status'
import { ProcessingView } from '@/features/processing/ProcessingView'
import { useAsync } from '@/hooks/useAsync'
import { Workspace } from './Workspace'

export function ProjectPage() {
  const { id = '' } = useParams()
  const { data: project, error, loading, reload } = useAsync(() => api.getProject(id), [id])
  const [retrying, setRetrying] = useState(false)
  const onFinished = useCallback(() => reload(), [reload])

  if (loading && !project) return <div className="p-8"><Spinner label="Cargando proyecto" /></div>
  if (error || !project)
    return (
      <div className="p-8">
        <ErrorState
          title={error && 'status' in error && error.status === 404 ? 'Proyecto no encontrado' : 'No se pudo cargar el proyecto'}
          message={error?.message}
          action={<Link className="text-accent underline" to="/proyectos">Volver a proyectos</Link>}
        />
      </div>
    )

  const retry = async () => {
    setRetrying(true)
    try {
      await api.reanalyze(project.id)
      reload()
    } finally {
      setRetrying(false)
    }
  }

  // mientras se muestra el pipeline en vivo, el proyecto está efectivamente procesándose
  const status = STATUS_LABEL[project.status === 'pending' ? 'processing' : project.status]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Link to="/proyectos" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg sm:min-h-0">
          Proyectos
        </Link>
        <span className="text-subtle" aria-hidden>/</span>
        <h1 className="truncate font-display text-base font-semibold">{project.name}</h1>
        <Badge tone={status.tone}>{status.text}</Badge>
      </div>

      {(project.status === 'pending' || project.status === 'processing') && <ProcessingView projectId={project.id} onFinished={onFinished} />}

      {project.status === 'failed' && (
        <div className="p-8">
          <ErrorState
            title="No pudimos reconocer el plano"
            message={`${project.error ?? 'Error desconocido'}. Prueba con una foto más frontal, con mejor luz, o ajusta las esquinas manualmente.`}
            action={
              <div className="flex gap-2">
                <Button icon={<RotateCcw className="size-4" aria-hidden />} loading={retrying} onClick={() => void retry()}>
                  Reintentar
                </Button>
                <Link to="/nuevo" className="inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm hover:border-accent">
                  Subir otra foto
                </Link>
              </div>
            }
          />
        </div>
      )}

      {project.status === 'ready' && <Workspace project={project} onReload={reload} />}
    </div>
  )
}
