import { Link, useParams } from 'react-router'
import { api } from '@/api/client'
import { ErrorState, Spinner } from '@/components/ui'
import { useTheme } from '@/lib/theme'
import { Workspace } from '@/features/workspace/Workspace'
import { useAsync } from '@/hooks/useAsync'

/** Ruta `/p/:id/estudio`: el mismo espacio de trabajo, a pantalla completa. */
export function StudioPage() {
  useTheme() // fuera del AppShell: el tema guardado se aplica igual
  const { id = '' } = useParams()
  const { data: project, error, loading, reload } = useAsync(() => api.getProject(id), [id])

  if (loading && !project)
    return (
      <div className="p-8">
        <Spinner label="Abriendo el estudio" />
      </div>
    )
  if (error || !project || project.status !== 'ready')
    return (
      <div className="p-8">
        <ErrorState
          title={project ? 'El plano todavía no está listo para editar' : 'No se pudo abrir el estudio'}
          message={error?.message}
          action={
            <Link className="text-accent underline" to={project ? `/p/${project.id}` : '/proyectos'}>
              {project ? 'Ver el proyecto' : 'Volver a proyectos'}
            </Link>
          }
        />
      </div>
    )
  return <Workspace project={project} onReload={reload} layout="studio" />
}
