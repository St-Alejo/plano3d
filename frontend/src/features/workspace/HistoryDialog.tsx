/** Historial de versiones del modelo: quién/qué se guardó, restaurar, y cuánto se corrigió la detección. */
import * as Dialog from '@radix-ui/react-dialog'
import { History, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { CorrectionStats, Revision } from '@/api/types'
import { Button, ErrorState, Spinner } from '@/components/ui'

const dateFmt = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

interface Loaded {
  revisions: Revision[]
  quality: CorrectionStats | null
}

export function HistoryDialog({
  projectId,
  currentRevision,
  dirty,
  onRestored,
  open: openProp,
  onOpenChange,
}: {
  projectId: string
  currentRevision: number
  dirty: boolean
  onRestored: () => void
  /** controlado desde fuera (p. ej. el menú "Más"): sin botón propio */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : innerOpen
  const setOpen = (o: boolean) => (controlled ? onOpenChange?.(o) : setInnerOpen(o))
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  // cada vez que se abre (por su botón o desde fuera) se recarga la lista: se limpia al cambiar
  // `open` durante el render (patrón de React para estado derivado) y se pide en el efecto
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setData(null)
      setError(null)
    }
  }
  useEffect(() => {
    if (!open) return
    let alive = true
    Promise.all([api.listRevisions(projectId), api.quality(projectId).catch(() => null)])
      .then(([revisions, quality]) => alive && setData({ revisions, quality }))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar el historial'))
    return () => {
      alive = false
    }
  }, [open, projectId])

  const restore = async (n: number) => {
    if (dirty && !window.confirm('Tienes cambios sin guardar que se perderán. ¿Restaurar igual?')) return
    setBusy(n)
    try {
      await api.restoreRevision(projectId, n, currentRevision)
      setOpen(false)
      onRestored()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restaurar')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={setOpen}
    >
      {!controlled && (
        <Dialog.Trigger asChild>
          <Button size="sm" variant="ghost" aria-label="Historial de versiones" title="Historial de versiones" icon={<History className="size-4" aria-hidden />}>
            <span className="hidden xl:inline">Historial</span>
          </Button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm" />
        <Dialog.Content className="corner-ticks fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 flex-col border border-line-strong bg-surface">
          <div className="border-b border-line p-5">
            <Dialog.Title className="font-display text-lg font-semibold">Historial de versiones</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">
              Cada guardado queda registrado. Restaurar crea una versión nueva: nunca se pierde nada.
            </Dialog.Description>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {error && <ErrorState title="Algo salió mal" message={error} />}
            {!data && !error && <Spinner label="Cargando historial" />}
            {data?.quality && (
              <section aria-labelledby="quality-title" className="mb-4 border-l-2 border-accent pl-3 text-sm">
                <h3 id="quality-title" className="font-medium">
                  Corrección sobre la detección automática: {Math.round(data.quality.correction_rate * 100)} %
                </h3>
                <p className="mt-1 font-mono text-xs text-muted">
                  {data.quality.walls_moved} muros movidos · {data.quality.walls_added} agregados · {data.quality.walls_deleted} borrados ·{' '}
                  {data.quality.openings_added + data.quality.openings_deleted} aberturas corregidas · {data.quality.rooms_relabeled} ambientes renombrados
                </p>
              </section>
            )}
            {data && (
              <ol className="flex flex-col">
                {data.revisions.map((r) => (
                  <li key={r.number} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        v{r.number} · {r.summary}
                        {r.number === currentRevision && <span className="ml-2 font-mono text-xs text-accent">(actual)</span>}
                      </p>
                      <p className="font-mono text-xs text-subtle">
                        {dateFmt.format(new Date(r.created_at))} · {r.wall_count} muros · {r.total_area.toFixed(1)} m²
                      </p>
                    </div>
                    {r.number !== currentRevision && (
                      <Button size="sm" loading={busy === r.number} icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => void restore(r.number)}>
                        Restaurar
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="flex justify-end border-t border-line p-4">
            <Dialog.Close asChild>
              <Button variant="ghost">Cerrar</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
