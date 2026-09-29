/**
 * Protege los cambios sin guardar al navegar DENTRO de la app (enlaces, botón atrás).
 * `beforeunload` solo cubre cerrar la pestaña; esto cubre el resto.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { useBlocker } from 'react-router'
import { Button } from '@/components/ui'

export function UnsavedChangesGuard({ dirty, onSave }: { dirty: boolean; onSave: () => Promise<boolean> }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  const [saving, setSaving] = useState(false)
  const open = blocker.state === 'blocked'

  const saveAndLeave = async () => {
    setSaving(true)
    const ok = await onSave()
    setSaving(false)
    if (ok) blocker.proceed?.()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && blocker.reset?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm" />
        <Dialog.Content className="corner-ticks fixed top-1/2 left-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 border border-line-strong bg-surface p-6">
          <Dialog.Title className="font-display text-lg font-semibold">Tienes cambios sin guardar</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Si sales ahora, las correcciones que hiciste en el plano se perderán.
          </Dialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Seguir editando
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Salir sin guardar
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void saveAndLeave()}>
              Guardar y salir
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
