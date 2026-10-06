/**
 * Paleta de comandos (Ctrl+K): busca cualquier acción del registro por su nombre,
 * sin tildes ni mayúsculas, y la ejecuta con Enter. Patrón combobox accesible.
 */
import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Kbd } from '@/components/ui'
import { normalize } from '@/features/projects/listing'
import { isAvailable, type EditorAction } from './actions'

export function filterActions(actions: EditorAction[], query: string): EditorAction[] {
  const q = normalize(query)
  return actions.filter((a) => !a.hidden && isAvailable(a) && (!q || normalize(`${a.group} ${a.label}`).includes(q)))
}

export function CommandPalette({ open, onOpenChange, actions }: { open: boolean; onOpenChange: (o: boolean) => void; actions: EditorAction[] }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  // se recalcula al abrir: la disponibilidad depende de la selección del momento
  const found = useMemo(() => (open ? filterActions(actions, query) : []), [open, actions, query])
  const current = Math.min(active, Math.max(found.length - 1, 0))

  const close = () => {
    onOpenChange(false)
    setQuery('')
    setActive(0)
  }
  const run = (a: EditorAction | undefined) => {
    if (!a) return
    close()
    a.run()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 border border-line-strong bg-surface shadow-2xl">
          <Dialog.Title className="sr-only">Buscar un comando</Dialog.Title>
          <Dialog.Description className="sr-only">Escribe para filtrar; flechas para elegir y Enter para ejecutar.</Dialog.Description>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search className="size-4 text-subtle" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={found[current] ? `${listId}-${found[current].id}` : undefined}
              aria-label="Comando"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((current + 1) % Math.max(found.length, 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((current - 1 + found.length) % Math.max(found.length, 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  run(found[current])
                }
              }}
              placeholder="¿Qué quieres hacer? (p. ej. duplicar, cotas, 3D)"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Comandos" className="max-h-[50vh] overflow-y-auto py-1">
            {found.map((a, i) => (
              <li
                key={a.id}
                id={`${listId}-${a.id}`}
                role="option"
                aria-selected={i === current}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(a)}
                className={clsx('flex cursor-pointer items-center gap-3 px-4 py-2 text-sm', i === current ? 'bg-raised text-fg' : 'text-muted')}
              >
                <span className="w-24 shrink-0 font-mono text-[11px] text-subtle uppercase">{a.group}</span>
                <span className="flex-1">{a.label}</span>
                {a.keys && <Kbd>{a.keys}</Kbd>}
              </li>
            ))}
            {found.length === 0 && <li className="px-4 py-6 text-center text-sm text-subtle">Ningún comando coincide.</li>}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
