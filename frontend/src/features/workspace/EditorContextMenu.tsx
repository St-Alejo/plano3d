/** Menú contextual (clic derecho) del lienzo 2D: las acciones del registro que aplican a la selección. */
import * as ContextMenu from '@radix-ui/react-context-menu'
import type { ReactNode } from 'react'
import { Kbd } from '@/components/ui'
import { CONTEXT_ACTIONS, isAvailable, type EditorAction } from './actions'

export function EditorContextMenu({ actions, children }: { actions: EditorAction[]; children: ReactNode }) {
  const items = CONTEXT_ACTIONS.map((id) => actions.find((a) => a.id === id)).filter((a): a is EditorAction => !!a)
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-56 border border-line-strong bg-surface py-1 text-sm shadow-xl" aria-label="Acciones">
          {items.map((a, i) => (
            <div key={a.id}>
              {i > 0 && a.group !== items[i - 1]!.group && <ContextMenu.Separator className="my-1 h-px bg-line" />}
              <ContextMenu.Item
                disabled={!isAvailable(a)}
                onSelect={() => a.run()}
                className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-raised"
              >
                {a.label}
                {a.keys && <Kbd>{a.keys}</Kbd>}
              </ContextMenu.Item>
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
