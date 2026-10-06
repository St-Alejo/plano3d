/** Ayuda de atajos (tecla ?): la tabla sale del mismo registro que ejecuta los atajos. */
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Kbd } from '@/components/ui'
import type { ActionGroup, EditorAction } from './actions'

const EXTRA: { group: ActionGroup; label: string; keys: string }[] = [
  { group: 'Edición', label: 'Mover la selección 5 cm (25 cm con Shift)', keys: '← ↑ → ↓' },
  { group: 'Selección', label: 'Agregar o quitar del grupo', keys: 'Shift+clic' },
  { group: 'Selección', label: 'Seleccionar por caja', keys: 'Shift+arrastrar' },
  { group: 'Selección', label: 'Caja hacia la izquierda: también lo que toca', keys: '←' },
  { group: 'Herramientas', label: 'Largo exacto tras dibujar un muro', keys: '3,5 Enter' },
]

export function ShortcutsHelp({ open, onOpenChange, actions }: { open: boolean; onOpenChange: (o: boolean) => void; actions: EditorAction[] }) {
  const rows = [
    ...actions.filter((a) => a.keys && !a.hidden).map((a) => ({ group: a.group, label: a.label, keys: a.keys! })),
    ...EXTRA,
  ]
  const groups = [...new Set(rows.map((r) => r.group))]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm" />
        <Dialog.Content className="corner-ticks fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-line-strong bg-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-serif text-3xl font-normal">Atajos de teclado</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                Todo lo que está aquí también se encuentra con <Kbd>Ctrl+K</Kbd>.
              </Dialog.Description>
            </div>
            <Dialog.Close className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg" aria-label="Cerrar">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {groups.map((g) => (
              <section key={g} aria-label={g}>
                <h3 className="mb-2 font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">{g}</h3>
                <dl className="divide-y divide-line">
                  {rows
                    .filter((r) => r.group === g)
                    .map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <dt>{r.label}</dt>
                        <dd>
                          <Kbd>{r.keys}</Kbd>
                        </dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
