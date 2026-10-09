/** Alternativa a subir una foto: crear un plano vacío y dibujarlo en el estudio. */
import { PencilRuler } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import { Button, TextField } from '@/components/ui'

export function StartBlank({ tutorial }: { tutorial?: ReactNode }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setSending(true)
    setError(null)
    try {
      const p = await api.createBlankProject(name.trim() || 'Plano nuevo')
      void navigate(`/p/${p.id}/estudio`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el plano')
      setSending(false)
    }
  }

  return (
    <section aria-labelledby="blank-title" className="mt-6 rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/10">
          <PencilRuler className="size-6 text-brand" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="blank-title" className="text-lg tracking-[-0.02em]">
            ¿No tienes el plano? Empieza desde cero
          </h2>
          <p className="mt-1 text-sm text-muted">
            Dibuja ambientes arrastrando rectángulos o escríbelos en el chat: «sala de 4x5», «cocina de 3x3 al este de la sala».
          </p>
        </div>
      </div>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <div className="sm:flex-1">
          <TextField label="Nombre del plano" value={name} maxLength={120} placeholder="Ej. Casa de campo" onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" variant="primary" loading={sending} icon={<PencilRuler className="size-4" aria-hidden />}>
          Empezar desde cero
        </Button>
        {tutorial}
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
