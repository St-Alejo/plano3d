import { Link } from 'react-router'
import { ErrorState } from './ui'

export function NotFound() {
  return (
    <div className="p-8">
      <ErrorState title="Página no encontrada" action={<Link className="text-accent underline" to="/proyectos">Ir a proyectos</Link>} />
    </div>
  )
}

