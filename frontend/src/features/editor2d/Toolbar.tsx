import { Redo2, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, ToolbarGroup } from '@/components/ui'
import { useEditor, type Tool } from '@/store/editorStore'
import { TOOLS } from './tools'

/** Las herramientas por intención: así la barra se lee de izquierda a derecha en vez de ser una fila plana. */
const GROUPS: { label: string; tools: Tool[] }[] = [
  { label: 'Selección', tools: ['select'] },
  { label: 'Dibujo', tools: ['room', 'wall', 'door', 'window'] },
  { label: 'Medición', tools: ['measure', 'dimension', 'calibrate'] },
  { label: 'Acabados', tools: ['paint'] },
]

export function Toolbar({ trailing }: { trailing?: ReactNode }) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useEditor()

  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface px-2 py-1" role="toolbar" aria-label="Herramientas del editor">
      {/* las herramientas se desplazan si no caben (sin barra de scroll, con un desvanecido al borde);
          deshacer y rehacer quedan siempre a la vista */}
      <div
        data-testid="herramientas"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] mask-r-from-[calc(100%-1.5rem)] xl:mask-none [&::-webkit-scrollbar]:hidden"
      >
        {GROUPS.map((g) => (
          <ToolbarGroup key={g.label} label={g.label}>
            {g.tools.map((id) => {
              const t = TOOLS.find((x) => x.id === id)!
              return (
                <IconButton key={t.id} label={t.label} shortcut={t.key} active={tool === t.id} onClick={() => setTool(t.id)}>
                  {t.icon}
                </IconButton>
              )
            })}
          </ToolbarGroup>
        ))}
      </div>
      <ToolbarGroup label="Historial de cambios">
        <IconButton label={undoLabel ? `Deshacer: ${undoLabel}` : 'Deshacer'} shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
          <Undo2 className="size-5" aria-hidden />
        </IconButton>
        <IconButton label={redoLabel ? `Rehacer: ${redoLabel}` : 'Rehacer'} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
          <Redo2 className="size-5" aria-hidden />
        </IconButton>
      </ToolbarGroup>
      <div className="flex shrink-0 items-center gap-1.5 border-l border-line pl-2 sm:border-0">{trailing}</div>
    </div>
  )
}
